use serde::{Deserialize, Serialize};
use std::{io::{Read, Write}, net::{IpAddr, Ipv4Addr, TcpListener, TcpStream, UdpSocket}, sync::{Arc, Mutex, atomic::{AtomicBool, Ordering}}, time::{Duration, Instant}};
use crate::Track;
use tauri::Manager;
use rusqlite::OptionalExtension;
use sha2::{Digest, Sha256};
type SyncHandler<'a> = dyn Fn(&str, &[u8]) -> Result<Vec<u8>, String> + 'a;

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SharedState { pub playlists: Vec<SharedPlaylist>, pub now: Option<SharedNow> }
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SharedPlaylist { pub id: String, pub name: String, pub tracks: Vec<Track> }
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SharedNow { pub track: Track, pub position: f64, pub playing: bool }
struct Host { stop: Arc<AtomicBool>, data: Arc<Mutex<(SharedState, Instant)>>, worker: std::thread::JoinHandle<()> }
#[derive(Default)]
pub struct Nearby(Mutex<Option<Host>>);
const MAX: usize = 1_000_000;
const DISCOVERY_PORT: u16 = 43127;

fn mac(token: &str, message: &[u8]) -> [u8; 32] {
    let mut key = [0u8; 64];
    key[..token.len()].copy_from_slice(token.as_bytes());
    let mut inner = [0x36u8; 64];
    let mut outer = [0x5cu8; 64];
    for i in 0..64 { inner[i] ^= key[i]; outer[i] ^= key[i]; }
    let mut hash = Sha256::new(); hash.update(inner); hash.update(message);
    let digest = hash.finalize();
    let mut hash = Sha256::new(); hash.update(outer); hash.update(digest);
    hash.finalize().into()
}

fn discover_response(token: &str, request: &[u8], port: u16, peer: Ipv4Addr) -> Option<[u8; 51]> {
    if !private(peer) || request.len() != 49 || request[0] != 1 { return None; }
    let expected = mac(token, &[b"lumaire-discovery-request-v1".as_slice(), &request[1..17]].concat());
    if !constant_time_eq(&expected, &request[17..49]) { return None; }
    let mut response = [0u8; 51];
    response[0] = 2; response[1..17].copy_from_slice(&request[1..17]);
    response[17..19].copy_from_slice(&port.to_be_bytes());
    let proof = mac(token, &[b"lumaire-discovery-response-v1".as_slice(), &response[1..19]].concat());
    response[19..].copy_from_slice(&proof);
    Some(response)
}

fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    left.len() == right.len() && left.iter().zip(right).fold(0u8, |diff, (a, b)| diff | (a ^ b)) == 0
}

fn private(ip: Ipv4Addr) -> bool { ip.is_private() || ip.is_loopback() }
pub(crate) fn clean_track(track: &mut Track) -> Result<(), String> {
    if track.title.is_empty() || track.format.len()>40 || [&track.title, &track.artist, &track.album].iter().any(|s| s.len() > 4000) || !track.duration.is_finite() || !(0.0..=86400.0).contains(&track.duration) { return Err("Invalid shared track metadata.".into()) }
    if track.format == "catalog" {
        if !crate::collection_io::valid(track) { return Err("Invalid shared catalog identity.".into()) }
    } else {
        let source = track.source.as_mut().ok_or("Local files cannot be shared.")?;
        if [&source.license,&source.license_url,&source.attribution].iter().any(|s|s.len()>4000) { return Err("Shared attribution is too large.".into()) }
        let youtube = source.provider_id == "youtube" && source.source_id.len() == 11 && source.source_id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-');
        let commons = source.provider_id == "wikimedia-commons" && source.source_id.parse::<u64>().is_ok_and(|id| id > 0);
        if (!youtube && !commons) || track.id != format!("{}:{}", source.provider_id, source.source_id) { return Err("Invalid shared source identity.".into()) }
        source.page_url = if youtube { format!("https://www.youtube.com/watch?v={}", source.source_id) } else { format!("https://commons.wikimedia.org/?curid={}", source.source_id) };
    }
    if track.recording_metadata.as_ref().is_some_and(|metadata| !metadata.valid()) {
        track.recording_metadata = None;
    }
    track.file_name.clear(); track.offline = false; track.missing = false;
    track.artwork_url = track.artwork_url.take().filter(|url| url.len() <= 4000 && url.starts_with("https://"));
    Ok(())
}
fn validate(data: &mut SharedState) -> Result<(), String> {
    if data.playlists.len() > 50 || data.playlists.iter().map(|p| p.tracks.len()).sum::<usize>() > 500 { return Err("Share up to 50 playlists and 500 tracks at a time.".into()) }
    for playlist in &mut data.playlists {
        if playlist.id.is_empty() || playlist.id.len() > 200 || playlist.name.is_empty() || playlist.name.len() > 400 { return Err("Invalid shared playlist.".into()) }
        for track in &mut playlist.tracks { clean_track(track)?; }
    }
    if let Some(now) = &mut data.now { clean_track(&mut now.track)?; if !now.position.is_finite() || !(0.0..=86400.0).contains(&now.position) { return Err("Invalid playback position.".into()) } }
    if serde_json::to_vec(data).map_err(|e| e.to_string())?.len() > MAX { return Err("Shared collection exceeds 1 MB.".into()) }
    Ok(())
}

fn serve(mut stream: TcpStream, token: &str, data: &Arc<Mutex<(SharedState, Instant)>>, stop: &AtomicBool, sync: Option<&SyncHandler<'_>>) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(2)));
    let mut bytes = Vec::new(); let mut part = [0; 1024];
    while bytes.len() < 8192 && !bytes.windows(4).any(|s| s == b"\r\n\r\n") {
        match stream.read(&mut part) { Ok(0) | Err(_) => return, Ok(n) => bytes.extend_from_slice(&part[..n]) }
    }
    let Some(header_end) = bytes.windows(4).position(|s|s==b"\r\n\r\n").map(|n|n+4) else { return };
    let Ok(headers) = std::str::from_utf8(&bytes[..header_end]) else { return };
    let mut lines = headers.split("\r\n");
    let request = lines.next().unwrap_or("");
    let authorized = lines.clone().any(|line| line.split_once(':').is_some_and(|(name, value)| name.eq_ignore_ascii_case("authorization") && value.trim() == format!("Bearer {token}")));
    let length = lines.clone().find_map(|line|line.split_once(':').filter(|(name,_)|name.eq_ignore_ascii_case("content-length")).and_then(|(_,v)|v.trim().parse::<usize>().ok())).unwrap_or(0);
    let origin = lines.any(|line| line.to_ascii_lowercase().starts_with("origin:") || line.to_ascii_lowercase().starts_with("transfer-encoding:"));
    let request = request.to_owned();
    let sync_request = matches!(request.as_str(), "GET /v2/hello HTTP/1.1" | "POST /v2/sync HTTP/1.1" | "GET /v3/hello HTTP/1.1" | "POST /v3/sync HTTP/1.1");
    let sync_body = if sync_request && authorized && !origin && !stop.load(Ordering::Relaxed) && length<=MAX && sync.is_some() {
        while bytes.len()<header_end+length { match stream.read(&mut part) { Ok(0)|Err(_)=>return,Ok(n)=>bytes.extend_from_slice(&part[..n]) } }
        Some(sync.unwrap()(&request,&bytes[header_end..header_end+length]))
    } else { None };
    let landing = request == "GET / HTTP/1.1" && !origin && !stop.load(Ordering::Relaxed);
    let (status, body) = if landing {
        ("200 OK", include_str!("../../src/nearby-pairing.html").as_bytes().to_vec())
    } else if let Some(result) = sync_body { match result { Ok(body)=>("200 OK",body),Err(error)=>("400 Bad Request",error.into_bytes()) }
    } else if request != "GET /v1/state HTTP/1.1" || !authorized || origin || stop.load(Ordering::Relaxed) { ("403 Forbidden", "Pairing refused.".as_bytes().to_vec()) } else {
        let Ok(state) = data.lock() else { return };
        let mut snapshot = state.0.clone();
        if let Some(now) = &mut snapshot.now { if now.playing { now.position += state.1.elapsed().as_secs_f64(); } }
        ("200 OK", serde_json::to_vec(&snapshot).unwrap_or_default())
    };
    let content_type = if landing { "text/html; charset=utf-8" } else { "application/json" };
    let _ = write!(stream, "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nX-Content-Type-Options: nosniff\r\nContent-Security-Policy: default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'\r\nConnection: close\r\nContent-Length: {}\r\n\r\n", body.len());
    let _ = stream.write_all(&body);
}

#[tauri::command]
pub fn nearby_start(app: tauri::AppHandle, state: tauri::State<'_, Nearby>) -> Result<String, String> {
    let mut host = state.0.lock().map_err(|_| "Nearby state unavailable.")?;
    if host.is_some() { return Err("A nearby session is already open. Stop it before starting again.".into()) }
    let socket = UdpSocket::bind("0.0.0.0:0").map_err(|e| e.to_string())?;
    socket.connect("192.0.2.1:80").map_err(|_| "Connect to Wi-Fi first.")?;
    let IpAddr::V4(ip) = socket.local_addr().map_err(|e| e.to_string())?.ip() else { return Err("An IPv4 Wi-Fi network is required.".into()) };
    if !private(ip) { return Err("Use a private Wi-Fi network for nearby sharing.".into()) }
    let credentials: Option<(u16,String)> = {
        let store=app.state::<crate::Store>();let db=store.0.lock().map_err(crate::err)?;
        db.query_row("SELECT port,token FROM sync_host WHERE id=1",[],|r|Ok((r.get(0)?,r.get(1)?))).optional().map_err(crate::err)?
    };
    let listener = TcpListener::bind((Ipv4Addr::UNSPECIFIED, credentials.as_ref().map(|c|c.0).unwrap_or(0))).map_err(|_| "Could not reopen the sync port. Close other Lumaire sharing sessions and retry.")?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let discovery = UdpSocket::bind((Ipv4Addr::UNSPECIFIED, DISCOVERY_PORT)).map_err(|_| "Could not open the authenticated nearby discovery port.")?;
    discovery.set_nonblocking(true).map_err(|e| e.to_string())?;
    let token = credentials.map(|c|c.1).unwrap_or_else(||uuid::Uuid::new_v4().simple().to_string());
    {
        let store=app.state::<crate::Store>();let db=store.0.lock().map_err(crate::err)?;
        db.execute("INSERT OR REPLACE INTO sync_host(id,port,token) VALUES(1,?1,?2)",rusqlite::params![port,token]).map_err(crate::err)?;
    }
    let link = format!("http://{ip}:{port}/#{token}");
    let stop = Arc::new(AtomicBool::new(false)); let data = Arc::new(Mutex::new((SharedState::default(), Instant::now())));
    let thread_stop = stop.clone(); let thread_data = data.clone();
    let worker = std::thread::spawn(move || {
        let mut packet = [0u8; 128];
        while !thread_stop.load(Ordering::Relaxed) {
            if let Ok((length, source)) = discovery.recv_from(&mut packet) {
                if let IpAddr::V4(peer) = source.ip() {
                    if let Some(response) = discover_response(&token, &packet[..length], port, peer) {
                        let _ = discovery.send_to(&response, source);
                    }
                }
            }
            match listener.accept() {
                Ok((stream, peer)) if matches!(peer.ip(), IpAddr::V4(ip) if private(ip)) => serve(stream, &token, &thread_data, &thread_stop, Some(&|path,body| {
                    let store=app.state::<crate::Store>();
                    let mut db=store.0.lock().map_err(crate::err)?;
                    crate::device_sync::handle(&mut db,path,body)
                })),
                _ => std::thread::sleep(Duration::from_millis(40)),
            }
        }
        thread_stop.store(true, Ordering::Relaxed);
    });
    *host = Some(Host { stop, data, worker }); Ok(link)
}
#[tauri::command]
pub fn nearby_stop(app: tauri::AppHandle, state: tauri::State<'_, Nearby>, forget: Option<bool>) -> Result<(), String> {
    if let Some(host) = state.0.lock().map_err(|_| "Nearby state unavailable.")?.take() {
        host.stop.store(true, Ordering::Relaxed);
        host.worker.join().map_err(|_| "Nearby listener did not shut down cleanly.")?;
    }
    if forget.unwrap_or(false) {
        let store = app.state::<crate::Store>();
        let db = store.0.lock().map_err(crate::err)?;
        db.execute("DELETE FROM sync_host", []).map_err(crate::err)?;
        let _ = db.execute("DELETE FROM sync_peer_info", []);
    }
    Ok(())
}
#[tauri::command]
pub fn nearby_publish(state: tauri::State<'_, Nearby>, mut data: SharedState) -> Result<(), String> {
    validate(&mut data)?;
    let host = state.0.lock().map_err(|_| "Nearby state unavailable.")?;
    let host = host.as_ref().ok_or("Start sharing first.")?;
    if host.stop.load(Ordering::Relaxed) { return Err("Nearby session expired. Start a new session.".into()) }
    *host.data.lock().map_err(|_| "Nearby state unavailable.")? = (data, Instant::now()); Ok(())
}
fn destination(link: &str) -> Result<(reqwest::Url, String), String> {
    let mut url = reqwest::Url::parse(link.trim()).map_err(|_| "Paste a Lumaire pairing link.")?;
    let ip = url.host_str().and_then(|s| s.parse::<Ipv4Addr>().ok()).filter(|ip| private(*ip)).ok_or("Only private Wi-Fi IPv4 addresses are allowed.")?;
    let token = url.fragment().filter(|s| s.len() == 32 && s.bytes().all(|c| c.is_ascii_hexdigit())).ok_or("Invalid pairing code.")?.to_owned();
    if url.scheme() != "http" || url.port().is_none() || !url.username().is_empty() || url.password().is_some() || url.path() != "/" || url.query().is_some() || ip.is_unspecified() { return Err("Invalid nearby pairing link.".into()) }
    url.set_fragment(None); url.set_path("/v1/state"); Ok((url, token))
}

#[tauri::command]
pub async fn nearby_rediscover(link: String) -> Result<String, String> {
    let (url, token) = destination(&link)?;
    let port = url.port().ok_or("Invalid nearby pairing link.")?;
    let token_for_worker = token.clone();
    tokio::task::spawn_blocking(move || {
        let socket = UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0)).map_err(|_| "Nearby discovery could not start.")?;
        socket.set_broadcast(true).map_err(|_| "Nearby broadcast is unavailable on this network.")?;
        socket.set_read_timeout(Some(Duration::from_millis(800))).map_err(crate::err)?;
        let nonce = *uuid::Uuid::new_v4().as_bytes();
        let proof = mac(&token_for_worker, &[b"lumaire-discovery-request-v1".as_slice(), &nonce].concat());
        let mut request = [0u8; 49]; request[0] = 1; request[1..17].copy_from_slice(&nonce); request[17..].copy_from_slice(&proof);
        socket.send_to(&request, (Ipv4Addr::BROADCAST, DISCOVERY_PORT)).map_err(|_| "Nearby discovery could not reach this Wi-Fi network.")?;
        let mut response = [0u8; 128];
        let (length, source) = socket.recv_from(&mut response).map_err(|_| "The paired device was not found on this Wi-Fi network.")?;
        let IpAddr::V4(ip) = source.ip() else { return Err("The paired device returned an invalid address.".into()) };
        if !private(ip) || length != 51 || response[0] != 2 || response[1..17] != nonce { return Err("The paired device returned an invalid discovery response.".into()) }
        let new_port = u16::from_be_bytes([response[17], response[18]]);
        if new_port == 0 || new_port != port { return Err("The paired device returned an invalid sync port.".into()) }
        let expected = mac(&token_for_worker, &[b"lumaire-discovery-response-v1".as_slice(), &response[1..19]].concat());
        if !constant_time_eq(&expected, &response[19..51]) { return Err("The nearby discovery response failed authentication.".into()) }
        Ok(format!("http://{ip}:{new_port}/#{token_for_worker}"))
    }).await.map_err(|_| "Nearby discovery failed.")?
}

#[tauri::command]
pub async fn nearby_fetch(link: String) -> Result<SharedState, String> {
    let (url, token) = destination(&link)?;
    let client = reqwest::Client::builder().no_proxy().redirect(reqwest::redirect::Policy::none()).timeout(Duration::from_secs(5)).build().map_err(|_| "Could not start nearby connection.")?;
    let mut response = client.get(url).bearer_auth(token).send().await.map_err(|_| "Cannot reach the other device. Check Wi-Fi, firewall permission and the pairing link.")?;
    if !response.status().is_success() { return Err("Pairing refused or expired. Ask the host for a new link.".into()) }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "Nearby connection interrupted.")? { if bytes.len() + chunk.len() > MAX { return Err("Shared response is too large.".into()) } bytes.extend_from_slice(&chunk); }
    let mut data = serde_json::from_slice(&bytes).map_err(|_| "The other device returned invalid collection data.")?;
    validate(&mut data)?; Ok(data)
}

async fn bounded(response: reqwest::Response) -> Result<Vec<u8>,String> {
    if !response.status().is_success() { return Err("Two-way sync requires updated apps and a valid pairing link.".into()) }
    let mut response=response; let mut bytes=vec![];
    while let Some(chunk)=response.chunk().await.map_err(|_|"Sync interrupted; retrying is safe.")? {
        if bytes.len()+chunk.len()>MAX { return Err("Sync response is too large.".into()) }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}
#[tauri::command]
pub async fn nearby_exchange(app: tauri::AppHandle, link: String) -> Result<bool,String> {
    use crate::device_sync::{self,Packet,Reply,State};
    let (mut url,token)=destination(&link)?; url.set_path("/v3/hello");
    let client=reqwest::Client::builder().no_proxy().redirect(reqwest::redirect::Policy::none()).timeout(Duration::from_secs(8)).build().map_err(crate::err)?;
    let response=client.get(url.clone()).bearer_auth(&token).send().await.map_err(|_|"Cannot reach paired device. Reconnect on the same network.")?;
    let v3=response.status().is_success();
    let response=if v3 { response } else if response.status()==reqwest::StatusCode::FORBIDDEN || response.status()==reqwest::StatusCode::NOT_FOUND {
        url.set_path("/v2/hello");
        client.get(url.clone()).bearer_auth(&token).send().await.map_err(crate::err)?
    } else { return Err("Cannot negotiate device sync.".into()) };
    let hello: State=serde_json::from_slice(&bounded(response).await?).map_err(|_|"Unsupported sync protocol.")?;
    if uuid::Uuid::parse_str(&hello.device_id).is_err() { return Err("Invalid peer identity.".into()) }
    let peer=hello.device_id.clone();
    let (packet,sent,outgoing_more)=crate::work(app.clone(),move |_,db|{
        let local=device_sync::state(db,false)?;
        let history=local.history_enabled && hello.history_enabled;
        let favorites=v3 && local.favorites_enabled && hello.favorites_enabled;
        let (mut sent,mut received)=device_sync::peer_favorites(db,&peer,history,favorites)?;
        if sent>local.revision || received>hello.revision { sent=0;received=0; }
        let outgoing=device_sync::page_favorites(db,sent,history,favorites,100)?;
        
        // Include our latest checkpoint in the packet
        let checkpoint = if v3 {
            db.query_row(
                "SELECT checkpoint FROM playback_checkpoints WHERE device_id=?1",
                [local.device_id.clone()],
                |row| row.get::<_, String>(0)
            ).optional().map_err(crate::err)?
            .and_then(|json| serde_json::from_str(&json).ok())
        } else {
            None
        };
        
        Ok((Packet{device_id:local.device_id,since:received,cells:outgoing.cells,history,favorites:if v3 {Some(favorites)} else {None},checkpoint},outgoing.cursor,outgoing.more))
    }).await?;
    url.set_path(if v3 {"/v3/sync"} else {"/v2/sync"});
    let body=serde_json::to_vec(&packet).map_err(crate::err)?;
    if body.len()>MAX { return Err("Sync page is too large.".into()) }
    let reply: Reply=serde_json::from_slice(&bounded(client.post(url).bearer_auth(token).header("Content-Type","application/json").body(body).send().await.map_err(|_|"Sync interrupted; changes remain saved for retry.")?).await?).map_err(|_|"Invalid sync response.")?;
    if reply.device_id!=hello.device_id || reply.cells.len()>100 || reply.cursor<packet.since { return Err("Invalid sync acknowledgement.".into()) }
    let more=reply.more || outgoing_more;
    crate::work(app,move |_,db|device_sync::accept(db,reply,sent)).await?;
    Ok(more)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn discovery_answers_only_authenticated_private_lan_requests() {
        let token = "1234567890abcdef1234567890abcdef";
        let nonce = [7u8; 16];
        let proof = mac(token, &[b"lumaire-discovery-request-v1".as_slice(), &nonce].concat());
        let mut request = [0u8; 49]; request[0] = 1; request[1..17].copy_from_slice(&nonce); request[17..].copy_from_slice(&proof);
        let response = discover_response(token, &request, 4321, Ipv4Addr::new(192, 168, 1, 5)).unwrap();
        assert_eq!(response[0], 2);
        assert_eq!(&response[1..17], &nonce);
        assert_eq!(u16::from_be_bytes([response[17], response[18]]), 4321);
        let expected = mac(token, &[b"lumaire-discovery-response-v1".as_slice(), &response[1..19]].concat());
        assert!(constant_time_eq(&expected, &response[19..]));
        let mut forged = request; forged[17] ^= 1;
        assert!(discover_response(token, &forged, 4321, Ipv4Addr::new(192, 168, 1, 5)).is_none());
        assert!(discover_response(token, &request, 4321, Ipv4Addr::new(8, 8, 8, 8)).is_none());
    }
    #[test]
    fn restricts_pairing_to_explicit_private_addresses_without_redirects_or_credentials() {
        let token = "1234567890abcdef1234567890abcdef";
        assert!(destination(&format!("http://192.168.1.5:1234/#{token}")).is_ok());
        for base in ["https://192.168.1.5:1234/", "http://example.com:1234/", "http://169.254.169.254:80/", "http://8.8.8.8:1234/", "http://user@192.168.1.5:1234/", "http://192.168.1.5:1234/private"] { assert!(destination(&format!("{base}#{token}")).is_err()); }
    }
    #[test]
    fn rejects_local_files_and_invalid_state() {
        let mut state = SharedState { playlists: vec![], now: Some(SharedNow { track: serde_json::from_value(serde_json::json!({"id":"local","title":"Song","artist":"Artist","album":"","duration":100,"fileName":"C:/secret.mp3","format":"MP3","missing":false})).unwrap(), position: 0.0, playing: false }) };
        assert!(validate(&mut state).is_err()); state.now = None; assert!(validate(&mut state).is_ok());
    }
    #[test]
    fn strips_invalid_optional_recording_metadata_at_sync_boundary() {
        let mut track: Track = serde_json::from_value(serde_json::json!({
            "id":"youtube:abcdefghijk", "title":"Song", "artist":"Artist", "album":"Album",
            "duration":100, "fileName":"song.m4a", "format":"m4a", "missing":false,
            "source":{"providerId":"youtube","sourceId":"abcdefghijk","pageUrl":"https://youtube.com/watch?v=abcdefghijk","license":"","licenseUrl":"","attribution":""},
            "recordingMetadata":{"sourceId":"invalid","isrcs":["not-an-isrc"],"releaseDate":"2024-02-31","artistAliases":{}}
        })).unwrap();
        clean_track(&mut track).unwrap();
        assert!(track.recording_metadata.is_none());
    }
    #[test]
    fn actual_http_requires_pairing_and_returns_validated_metadata() {
        let token = "1234567890abcdef1234567890abcdef";
        let runtime = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        for authorized in [false, true] {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let port = listener.local_addr().unwrap().port();
            let data = Arc::new(Mutex::new((SharedState::default(), Instant::now())));
            let worker = std::thread::spawn(move || { let (stream, _) = listener.accept().unwrap(); serve(stream, token, &data, &AtomicBool::new(false), None); });
            let link = format!("http://127.0.0.1:{port}/#{}", if authorized { token } else { "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" });
            let response = runtime.block_on(nearby_fetch(link));
            assert_eq!(response.is_ok(), authorized);
            if let Ok(state) = response { assert!(state.playlists.is_empty()); assert!(state.now.is_none()); }
            worker.join().unwrap();
        }
    }
    #[test]
    fn actual_http_sync_commits_before_acknowledging_and_retries_idempotently() {
        use crate::device_sync::{self,Packet,Reply};
        let token="1234567890abcdef1234567890abcdef";
        let listener=TcpListener::bind("127.0.0.1:0").unwrap();let base=format!("http://{}",listener.local_addr().unwrap());
        let worker=std::thread::spawn(move || {
            let mut db=rusqlite::Connection::open_in_memory().unwrap();crate::initialize(&mut db).unwrap();let db=Mutex::new(db);
            let data=Arc::new(Mutex::new((SharedState::default(),Instant::now())));
            for _ in 0..4 {
                let (stream,_)=listener.accept().unwrap();
                serve(stream,token,&data,&AtomicBool::new(false),Some(&|path,bytes|device_sync::handle(&mut db.lock().unwrap(),path,bytes)));
            }
            assert_eq!(device_sync::state(&db.lock().unwrap(),true).unwrap().cells.len(),1);
        });
        let runtime=tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        runtime.block_on(async {
            let client=reqwest::Client::builder().no_proxy().build().unwrap();
            let peer=uuid::Uuid::new_v4().to_string();
            let packet=Packet{device_id:peer.clone(),since:0,cells:vec![device_sync::Cell{key:device_sync::key(&["name","mix"]),clock:1,device:peer,value:serde_json::json!("Concurrent mix")}],history:false,favorites:None,checkpoint:None};
            let refused=client.post(format!("{base}/v2/sync")).json(&packet).send().await.unwrap();assert_eq!(refused.status().as_u16(),403);
            let hello=client.get(format!("{base}/v2/hello")).bearer_auth(token).send().await.unwrap();assert!(hello.status().is_success());
            for _ in 0..2 {
                let reply:Reply=serde_json::from_slice(&bounded(client.post(format!("{base}/v2/sync")).bearer_auth(token).json(&packet).send().await.unwrap()).await.unwrap()).unwrap();
                assert_eq!(reply.cells.len(),1);assert_eq!(reply.cells[0].value,"Concurrent mix");
            }
        });
        worker.join().unwrap();
    }
    #[test]
    fn browser_landing_never_exposes_pairing_token_or_bypasses_api_auth() {
        let token = "1234567890abcdef1234567890abcdef";
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let worker = std::thread::spawn(move || {
            let data = Arc::new(Mutex::new((SharedState::default(), Instant::now())));
            for _ in 0..4 {
                let (stream, _) = listener.accept().unwrap();
                serve(stream, token, &data, &AtomicBool::new(false), None);
            }
        });
        let runtime = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        runtime.block_on(async {
            let client = reqwest::Client::new();
            for (path, auth, origin, expected) in [("/", false, false, 200), ("/v1/state", false, false, 403), ("/", false, true, 403), ("/v1/state", true, false, 200)] {
                let mut request = client.get(format!("{base}{path}"));
                if auth { request = request.bearer_auth(token); }
                if origin { request = request.header("Origin", "https://example.test"); }
                let response = request.send().await.unwrap();
                assert_eq!(response.status().as_u16(), expected);
                if path == "/" && expected == 200 {
                    assert_eq!(response.headers()["referrer-policy"], "no-referrer");
                    assert!(response.headers()["content-type"].to_str().unwrap().starts_with("text/html"));
                    let html = response.text().await.unwrap();
                    assert!(html.contains("Pair with Lumaire"));
                    assert!(!html.contains(token));
                }
            }
        });
        worker.join().unwrap();
    }
}
