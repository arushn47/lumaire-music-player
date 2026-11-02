use crate::{allow, err, resolve_commons_audio_inner, work, Result, Track};
use rusqlite::{params, OptionalExtension};
use std::{
    collections::HashMap,
    fs,
    io::{Seek, Write},
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
    time::Duration,
};
use tauri::Manager;

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    stage: &'static str,
    received: u64,
    total: Option<u64>,
    bytes_per_second: f64,
}

fn progress(channel: Option<&tauri::ipc::Channel<DownloadProgress>>, stage: &'static str, received: u64, total: Option<u64>, bytes_per_second: f64) {
    if let Some(channel) = channel { let _ = channel.send(DownloadProgress { stage, received, total, bytes_per_second }); }
}

#[cfg(any(target_os = "android", test))]
fn android_download_source(value: &serde_json::Value) -> Result<(String, &'static str, reqwest::header::HeaderMap)> {
    crate::ytdlp::validate_audio_codecs(value["codec"].as_str(), value["videoCodec"].as_str())?;
    let url = value["url"].as_str().ok_or("Android returned no audio download URL.")?;
    if !download_location_allowed(&reqwest::Url::parse(url).map_err(err)?, true) { return Err("Unsupported download location.".into()); }
    let extension = match value["container"].as_str() {
        Some("m4a") => "m4a",
        _ => return Err("This recording has no supported offline audio stream.".into()),
    };
    let mut headers = reqwest::header::HeaderMap::new();
    if let Some(values) = value.get("headers") {
        let values = values.as_object().ok_or("Invalid audio headers.")?;
        if values.len() > 6 { return Err("Too many audio headers.".into()); }
        for (name, value) in values {
            let value = value.as_str().ok_or("Invalid audio header.")?;
            if !["user-agent", "accept", "accept-language", "referer", "origin", "sec-fetch-mode"].contains(&name.to_ascii_lowercase().as_str()) || value.len() > 4096 || value.contains(['\r', '\n']) {
                return Err("Unsupported audio header.".into());
            }
            headers.insert(reqwest::header::HeaderName::from_bytes(name.as_bytes()).map_err(err)?, reqwest::header::HeaderValue::from_str(value).map_err(err)?);
        }
    }
    Ok((url.to_owned(), extension, headers))
}

fn jobs() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    static JOBS: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();
    JOBS.get_or_init(|| Mutex::new(HashMap::new()))
}
struct Job(String);
impl Drop for Job {
    fn drop(&mut self) {
        if let Ok(mut jobs) = jobs().lock() {
            jobs.remove(&self.0);
        }
    }
}
struct Partial {
    path: PathBuf,
    keep_on_drop: bool,
}
impl Partial {
    #[cfg_attr(not(test), allow(dead_code))]
    fn new(path: PathBuf) -> Self {
        Self { path, keep_on_drop: false }
    }
}
impl Drop for Partial {
    fn drop(&mut self) {
        if !self.keep_on_drop {
            let _ = fs::remove_file(&self.path);
        }
    }
}

pub(crate) fn root(app: &tauri::AppHandle) -> Result<PathBuf> {
    #[cfg(debug_assertions)]
    let data = std::env::var_os("LUMAIRE_DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or(app.path().app_data_dir().map_err(err)?);
    #[cfg(not(debug_assertions))]
    let data = app.path().app_data_dir().map_err(err)?;
    let root = data.join("downloads");
    fs::create_dir_all(&root).map_err(err)?;
    let resolved = root.canonicalize().map_err(err)?;
    if resolved != data.canonicalize().map_err(err)?.join("downloads") {
        return Err("Managed download storage must not be a directory link.".into());
    }
    Ok(resolved)
}

pub fn cleanup_incomplete(directory: &std::path::Path) {
    if directory.canonicalize().ok()
        != directory
            .parent()
            .and_then(|parent| parent.canonicalize().ok())
            .map(|parent| parent.join("downloads"))
    {
        return;
    }
    let Ok(entries) = fs::read_dir(directory) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|extension| extension.to_str()) != Some("part")
            || path
                .file_stem()
                .and_then(|stem| stem.to_str())
                .is_none_or(|stem| uuid::Uuid::parse_str(stem).is_err())
        {
            continue;
        }
        if let Ok(metadata) = entry.metadata() {
            if metadata.is_file()
                && metadata
                    .modified()
                    .ok()
                    .and_then(|time| time.elapsed().ok())
                    .is_some_and(|age| age > Duration::from_secs(86_400))
            {
                let _ = fs::remove_file(path);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn android_downloads_use_only_validated_audio_urls_and_scoped_resolver_headers() {
        let valid = serde_json::json!({"url":"https://rr1.googlevideo.com/audio", "container":"m4a", "codec":"mp4a.40.2", "videoCodec":"none", "headers":{"User-Agent":"fixture","Origin":"https://www.youtube.com"}});
        let (url, extension, headers) = android_download_source(&valid).unwrap();
        assert_eq!(url, "https://rr1.googlevideo.com/audio");
        assert_eq!(extension, "m4a");
        assert_eq!(headers["user-agent"], "fixture");
        for (field, value) in [("videoCodec",serde_json::json!("h264")),("codec",serde_json::json!("none")),("container",serde_json::json!("mp4")),("url", serde_json::json!("https://example.org/audio")), ("container", serde_json::json!("webm")), ("headers", serde_json::json!({"Cookie":"private"})), ("headers", serde_json::json!({"User-Agent":"a\r\nb"}))] {
            let mut invalid = valid.clone(); invalid[field] = value;
            assert!(android_download_source(&invalid).is_err());
        }
    }
    #[test]
    fn completion_keeps_latest_catalogue_metadata_and_revalidated_commons_credits() {
        let mut db = rusqlite::Connection::open_in_memory().unwrap();
        crate::initialize(&mut db).unwrap();
        let mut downloaded: Track = serde_json::from_value(serde_json::json!({
            "id":"wikimedia-commons:42", "title":"Old title", "artist":"Old artist", "album":"", "duration":1,
            "fileName":"original.wav", "format":"WAV", "missing":false,
            "source":{"providerId":"wikimedia-commons", "sourceId":"42", "pageUrl":"untrusted",
                "license":"Old license", "licenseUrl":"https://example.org/old", "attribution":"Old credit"}
        })).unwrap();
        crate::save_remote(&db, downloaded.clone()).unwrap();
        let mut latest = downloaded.clone();
        latest.title = "Catalogue title".into();
        latest.artist = "Catalogue artist".into();
        latest.album = "Catalogue album".into();
        latest.duration = 180.0;
        latest.artwork_url = Some("https://upload.wikimedia.org/catalogue.jpg".into());
        latest.metadata_source_id = Some("itunes:123".into());
        crate::save_remote(&db, latest.clone()).unwrap();
        let checked = downloaded.source.as_mut().unwrap();
        checked.license = "CC-BY-SA 4.0".into();
        checked.license_url = "https://creativecommons.org/licenses/by-sa/4.0/".into();
        checked.attribution = "Revalidated creator".into();
        let saved = finish_download(&db, &downloaded, "managed.wav").unwrap();
        assert_eq!(saved.id, latest.id);
        assert_eq!(saved.title, latest.title);
        assert_eq!(saved.artist, latest.artist);
        assert_eq!(saved.album, latest.album);
        assert_eq!(saved.duration, latest.duration);
        assert_eq!(saved.artwork_url, latest.artwork_url);
        assert_eq!(saved.metadata_source_id, latest.metadata_source_id);
        assert!(saved.offline && !saved.missing);
        let source = saved.source.unwrap();
        assert_eq!(source.source_id, "42");
        assert_eq!(source.page_url, "https://commons.wikimedia.org/?curid=42");
        assert_eq!(source.license, "CC-BY-SA 4.0");
        assert_eq!(
            source.license_url,
            "https://creativecommons.org/licenses/by-sa/4.0/"
        );
        assert_eq!(source.attribution, "Revalidated creator");
        let (path, metadata): (String, String) = db
            .query_row(
                "SELECT path,metadata FROM tracks WHERE id=?1",
                [&latest.id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(path, "managed.wav");
        assert!(metadata.contains("Revalidated creator") && metadata.contains("Catalogue title"));
        let mut different_source = downloaded.clone();
        different_source.source.as_mut().unwrap().source_id = "43".into();
        assert!(finish_download(&db, &different_source, "different.wav").is_err());
        db.execute("DELETE FROM tracks WHERE id=?1", [&latest.id])
            .unwrap();
        assert!(finish_download(&db, &downloaded, "removed.wav").is_err());
        assert_eq!(
            db.query_row("SELECT COUNT(*) FROM tracks", [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }
    #[test]
    fn download_locations_are_provider_scoped_including_redirects() {
        for (url, youtube, expected) in [
            (
                "https://rr1---sn-example.googlevideo.com/videoplayback?token=private",
                true,
                true,
            ),
            (
                "https://upload.wikimedia.org/wikipedia/commons/audio.ogg",
                false,
                true,
            ),
            ("https://evilgooglevideo.com/audio", true, false),
            ("https://googlevideo.com.evil.test/audio", true, false),
            ("https://rr1.googlevideo.com:8443/audio", true, false),
            ("http://rr1.googlevideo.com/audio", true, false),
            (
                "https://user:password@rr1.googlevideo.com/audio",
                true,
                false,
            ),
            ("https://127.0.0.1/audio", true, false),
            ("https://upload.wikimedia.org/audio", true, false),
            ("https://rr1.googlevideo.com/audio", false, false),
        ] {
            assert_eq!(
                download_location_allowed(&reqwest::Url::parse(url).unwrap(), youtube),
                expected
            );
        }
    }
    #[test]
    fn content_range_parsing_handles_standard_wildcard_and_invalid_formats() {
        assert_eq!(
            parse_content_range("bytes 0-1048575/4194304"),
            Some(ContentRange { start: 0, end: 1048575, total: Some(4194304) })
        );
        assert_eq!(
            parse_content_range("bytes 2097152-4194303/4194304"),
            Some(ContentRange { start: 2097152, end: 4194303, total: Some(4194304) })
        );
        assert_eq!(
            parse_content_range("bytes 0-500/*"),
            Some(ContentRange { start: 0, end: 500, total: None })
        );
        assert_eq!(parse_content_range(""), None);
        assert_eq!(parse_content_range("items 0-10/100"), None);
        assert_eq!(parse_content_range("bytes abc-def/ghi"), None);
        assert_eq!(parse_content_range("bytes 0-10"), None);
        assert_eq!(parse_content_range("bytes 10-9/100"), None);
        assert_eq!(parse_content_range("bytes 0-10/10"), None);
        assert_eq!(parse_content_range("bytes 0-10/100/extra"), None);
        assert_eq!(parse_content_range("bytes 0-10-20/100"), None);
        assert!(content_range_matches("bytes 8-15/100", 8, 15, 100));
        assert!(!content_range_matches("bytes 7-15/100", 8, 15, 100));
        assert!(!content_range_matches("bytes 8-16/100", 8, 15, 100));
        assert!(!content_range_matches("bytes 8-15/101", 8, 15, 100));
    }
    fn wav() -> String {
        let mut bytes = b"RIFF".to_vec();
        bytes.extend(52u32.to_le_bytes());
        bytes.extend(b"WAVEfmt ");
        bytes.extend(16u32.to_le_bytes());
        bytes.extend(1u16.to_le_bytes());
        bytes.extend(1u16.to_le_bytes());
        bytes.extend(8000u32.to_le_bytes());
        bytes.extend(8000u32.to_le_bytes());
        bytes.extend(1u16.to_le_bytes());
        bytes.extend(8u16.to_le_bytes());
        bytes.extend(b"data");
        bytes.extend(16u32.to_le_bytes());
        bytes.extend([0u8; 16]);
        String::from_utf8(bytes).unwrap()
    }
    #[test]
    fn downloaded_audio_is_validated_and_partial_files_are_removed_on_failure_or_cancel() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        for (status, body, cancel, success) in [
            ("200 OK", wav(), false, true),
            ("200 OK", "not audio".into(), false, false),
            ("200 OK", wav(), true, false),
            ("206 Partial Content", wav(), false, false),
            ("403 Forbidden", wav(), false, false),
        ] {
            let (url, server) = crate::provider_http::tests::server(vec![(status, body)]);
            let path = std::env::temp_dir().join(format!("{}.part", uuid::Uuid::new_v4()));
            {
                let _partial = Partial::new(path.clone());
                let events = Arc::new(Mutex::new(Vec::new()));
                let recorded = events.clone();
                let channel = tauri::ipc::Channel::<DownloadProgress>::new(move |body| {
                    if let tauri::ipc::InvokeResponseBody::Json(json) = body {
                        recorded.lock().unwrap().push(serde_json::from_str::<serde_json::Value>(&json).unwrap());
                    }
                    Ok(())
                });
                let outcome = runtime.block_on(async {
                    let response = reqwest::get(url).await.unwrap();
                    transfer_audio(response, &path, &AtomicBool::new(cancel), Some(&channel)).await
                });
                assert_eq!(outcome.is_ok(), success);
                if success {
                    let events = events.lock().unwrap();
                    assert_eq!(events.first().unwrap()["stage"], "transferring");
                    let last = events.last().unwrap();
                    assert_eq!(last["stage"], "validating");
                    assert_eq!(last["received"], last["total"]);
                    assert!(last["received"].as_u64().unwrap() > 0);
                }
            }
            assert!(!path.exists());
            server.join().unwrap();
        }
    }

    
    #[test]
    fn download_queue_persists_and_recovers_interrupted_tracks() {
        let mut db = rusqlite::Connection::open_in_memory().unwrap();
        db.execute_batch("CREATE TABLE download_queue (track_id TEXT PRIMARY KEY, collection_id TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL, added_at INTEGER NOT NULL);
            INSERT INTO download_queue VALUES ('t1', 'col1', 'Song 1', 'downloading', 100), ('t2', 'col1', 'Song 2', 'completed', 101);").unwrap();
        crate::initialize(&mut db).unwrap();
        db.execute("UPDATE download_queue SET status='pending' WHERE status='downloading'", []).unwrap();
        let status: String = db.query_row("SELECT status FROM download_queue WHERE track_id='t1'", [], |r| r.get(0)).unwrap();
        assert_eq!(status, "pending");
        let completed: String = db.query_row("SELECT status FROM download_queue WHERE track_id='t2'", [], |r| r.get(0)).unwrap();
        assert_eq!(completed, "completed");
        let track = serde_json::json!({"id":"t1","title":"Song 1","artist":"Artist","album":"Album","artists":[],"duration":60});
        db.execute("UPDATE download_queue SET track_data=?1 WHERE track_id='t1'", [track.to_string()]).unwrap();
        let mut stmt = db.prepare("SELECT track_id,collection_id,title,status,added_at,track_data FROM download_queue WHERE track_id='t1'").unwrap();
        let restored = stmt.query_row([], download_queue_entry).unwrap();
        assert_eq!(restored.track, Some(track));
    }

    #[test]
    #[ignore = "explicit licensed Commons transfer check; requires network"]
    fn live_licensed_commons_audio_transfer() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        runtime.block_on(async {
            let tracks = crate::search_commons_audio("piano".into()).await.unwrap();
            assert!(!tracks.is_empty(), "No licensed audio returned");
            let source = &tracks[0].source;
            let media = crate::resolve_commons_audio_inner(source.source_id.clone())
                .await
                .unwrap();
            let path = std::env::temp_dir().join(format!("{}.part", uuid::Uuid::new_v4()));
            let _partial = Partial::new(path.clone());
            let client = reqwest::Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .timeout(Duration::from_secs(30))
                .user_agent("Lumaire/0.1 licensed offline audio")
                .build()
                .unwrap();
            let started = std::time::Instant::now();
            let cancel = AtomicBool::new(false);
            transfer_resumable_audio(&client, &media.url, &path, &cancel, false, None)
                .await
                .unwrap();
            let elapsed = started.elapsed();
            let file_len = fs::metadata(&path).unwrap().len();
            let mb_per_sec = (file_len as f64 / 1_048_576.0) / elapsed.as_secs_f64();
            assert!(file_len > 44);
            eprintln!(
                "Verified licensed audio transfer: {} bytes in {:.2}s ({:.2} MB/s) | {} | {} | {}",
                file_len, elapsed.as_secs_f64(), mb_per_sec, tracks[0].title, source.attribution, source.license
            );
        });
    }
}

#[tauri::command]
pub fn cancel_download(id: String) -> Result<()> {
    if let Some(cancel) = jobs().lock().map_err(err)?.get(&id) {
        cancel.store(true, Ordering::Relaxed);
    }
    Ok(())
}

#[tauri::command]
pub async fn download_track(app: tauri::AppHandle, webview: tauri::Webview, id: String, on_progress: Option<tauri::ipc::JavaScriptChannelId>) -> Result<Track> {
    let on_progress = on_progress.map(|channel| channel.channel_on::<_, DownloadProgress>(webview));
    progress(on_progress.as_ref(), "resolving", 0, None, 0.0);
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut jobs = jobs().lock().map_err(err)?;
        if jobs.contains_key(&id) {
            return Err("This download is already running.".into());
        }
        jobs.insert(id.clone(), cancel.clone());
    }
    let _job = Job(id.clone());
    let lookup = id.clone();
    let existing = work(app.clone(), move |_, db| {
        let (metadata, path): (String, Option<String>) = db
            .query_row(
                "SELECT metadata,path FROM tracks WHERE id=?1",
                [lookup],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .map_err(err)?;
        let track: Track = serde_json::from_str(&metadata).map_err(err)?;
        Ok((track, path))
    })
    .await?;
    let mut track = existing.0;
    if track.offline
        && existing
            .1
            .as_ref()
            .is_some_and(|path| std::path::Path::new(path).is_file())
    {
        crate::audio_container::require_audio_only(std::path::Path::new(existing.1.as_ref().unwrap()))?;
        return Ok(track);
    }
    let source = track
        .source
        .as_ref()
        .ok_or("Local files are already available offline.")?;
    // Resolve the selected source in the backend. Never transfer a renderer URL.
    // Commons reuse eligibility is rechecked; YouTube availability is not a license.
    let youtube = source.provider_id == "youtube";
    let (url, extension, headers) = if youtube {
        #[cfg(target_os = "android")]
        {
            let audio = crate::android::call(&app, "resolveSource", serde_json::json!({"operation":"resolve", "videoId":source.source_id, "download":true})).await?;
            android_download_source(&audio)?
        }
        #[cfg(not(target_os = "android"))]
        {
        let audio = crate::ytdlp::download_audio(source.source_id.clone()).await?;
        let extension = match audio.container.as_deref() {
            Some("m4a") => "m4a",
            _ => return Err("This video has no supported offline audio stream.".into()),
        };
        (audio.stream_url, extension, reqwest::header::HeaderMap::new())
        }
    } else if source.provider_id == "wikimedia-commons" {
        let media = resolve_commons_audio_inner(source.source_id.clone()).await?;
        if let Some(source) = track.source.as_mut() {
            source.license = media.license;
            source.license_url = media.license_url;
            source.attribution = media.attribution;
        }
        let extension = match media.mime_type.as_str() {
            "audio/mpeg" => "mp3",
            "audio/ogg" => "ogg",
            "audio/wav" => "wav",
            "audio/flac" => "flac",
            _ => return Err("Unsupported audio format.".into()),
        };
        (media.url, extension, reqwest::header::HeaderMap::new())
    } else {
        return Err("This source does not support offline downloads.".into());
    };
    if cancel.load(Ordering::Relaxed) {
        return Err("Download cancelled.".into());
    }
    let directory = root(&app)?;
    let token = uuid::Uuid::new_v5(&uuid::Uuid::NAMESPACE_OID, track.id.as_bytes());
    let partial_path = directory.join(format!("{token}.part"));
    let destination = directory.join(format!("{token}.{extension}"));
    let mut partial = Partial {
        path: partial_path.clone(),
        keep_on_drop: false,
    };
    let client = reqwest::Client::builder()
        .default_headers(headers)
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
        .user_agent("Mozilla/5.0 Lumaire/0.1 offline audio")
        .build()
        .map_err(err)?;
    progress(on_progress.as_ref(), "connecting", 0, None, 0.0);
    match transfer_resumable_audio(&client, &url, &partial_path, &cancel, youtube, on_progress.as_ref()).await {
        Ok(()) if cancel.load(Ordering::Relaxed) => {
            partial.keep_on_drop = false;
            Err("Download cancelled.".into())
        }
        Ok(()) => {
            fs::rename(&partial_path, &destination).map_err(err)?;
            partial.keep_on_drop = true;
            let mut complete = Partial {
                path: destination.clone(),
                keep_on_drop: false,
            };
            let saved_path = destination.to_string_lossy().into_owned();
            let saved = work(app, move |app, db| {
                allow(app, &destination)?;
                finish_download(db, &track, &saved_path)
            })
            .await?;
            complete.keep_on_drop = true; // ownership transferred to the persisted library
            Ok(saved)
        }
        Err(e) => {
            if cancel.load(Ordering::Relaxed) {
                partial.keep_on_drop = false; // clean up on explicit user cancel
            } else {
                partial.keep_on_drop = true; // keep partial file for resumable retry
            }
            Err(e)
        }
    }
}

fn finish_download(
    db: &rusqlite::Connection,
    downloaded: &Track,
    saved_path: &str,
) -> Result<Track> {
    let latest: Option<String> = db
        .query_row(
            "SELECT metadata FROM tracks WHERE id=?1",
            [&downloaded.id],
            |row| row.get(0),
        )
        .optional()
        .map_err(err)?;
    let mut track: Track =
        serde_json::from_str(&latest.ok_or("The track was removed while downloading.")?)
            .map_err(err)?;
    let checked = downloaded
        .source
        .as_ref()
        .ok_or("The audio source changed while downloading.")?;
    let source = track
        .source
        .as_mut()
        .filter(|source| {
            source.provider_id == checked.provider_id && source.source_id == checked.source_id
        })
        .ok_or("The audio source changed while downloading.")?;
    if checked.provider_id == "wikimedia-commons" {
        source.license = checked.license.clone();
        source.license_url = checked.license_url.clone();
        source.attribution = checked.attribution.clone();
    }
    track.offline = true;
    track.missing = false;
    db.execute(
        "UPDATE tracks SET path=?1,metadata=?2 WHERE id=?3",
        params![
            saved_path,
            serde_json::to_string(&track).map_err(err)?,
            track.id
        ],
    )
    .map_err(err)?;
    let _ = db.execute("UPDATE download_queue SET status='completed' WHERE track_id=?1", params![track.id]);
    Ok(track)
}

#[tauri::command]
pub async fn delete_download(app: tauri::AppHandle, id: String, confirmed: bool) -> Result<Track> {
    if !confirmed {
        return Err("Confirm deletion of the app-owned offline copy.".into());
    }
    let directory = root(&app)?;
    work(app, move |_, db| {
        let (metadata, path): (String, Option<String>) = db
            .query_row(
                "SELECT metadata,path FROM tracks WHERE id=?1",
                [&id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(err)?
            .ok_or("This track is no longer in the library.")?;
        let mut track: Track = serde_json::from_str(&metadata).map_err(err)?;
        if !track.offline || track.source.is_none() {
            return Err("This is not an app-owned offline copy.".into());
        }
        if let Some(path) = path {
            let path = PathBuf::from(path);
            if path
                .parent()
                .and_then(|parent| parent.canonicalize().ok())
                .as_ref()
                != Some(&directory)
                || path
                    .file_stem()
                    .and_then(|stem| stem.to_str())
                    .is_none_or(|stem| uuid::Uuid::parse_str(stem).is_err())
            {
                return Err("The stored file is outside managed download storage.".into());
            }
            match fs::symlink_metadata(&path) {
                Ok(metadata) => {
                    if metadata.file_type().is_symlink() {
                        return Err("Refusing to delete a linked file.".into());
                    }
                    fs::remove_file(path).map_err(err)?;
                }
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => (),
                Err(error) => return Err(error.to_string()),
            }
        }
        track.offline = false;
        db.execute(
            "UPDATE tracks SET path=NULL,metadata=?1 WHERE id=?2",
            params![serde_json::to_string(&track).map_err(err)?, id],
        )
        .map_err(err)?;
        let _ = db.execute("DELETE FROM download_queue WHERE track_id=?1", params![id]);
        Ok(track)
    })
    .await
}

fn download_location_allowed(location: &reqwest::Url, youtube: bool) -> bool {
    let host = location.host_str().unwrap_or_default();
    location.scheme() == "https"
        && (if youtube {
            host.ends_with(".googlevideo.com")
        } else {
            host == "upload.wikimedia.org"
        })
        && location.username().is_empty()
        && location.password().is_none()
        && location.port_or_known_default() == Some(443)
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) struct ContentRange {
    pub start: u64,
    pub end: u64,
    pub total: Option<u64>,
}

pub(crate) fn parse_content_range(header: &str) -> Option<ContentRange> {
    let header = header.trim();
    if !header.to_ascii_lowercase().starts_with("bytes ") {
        return None;
    }
    let rest = &header[6..];
    let mut parts = rest.split('/');
    let range_part = parts.next()?;
    let total_part = parts.next()?;
    if parts.next().is_some() {
        return None;
    }
    let mut range_bounds = range_part.split('-');
    let start: u64 = range_bounds.next()?.trim().parse().ok()?;
    let end: u64 = range_bounds.next()?.trim().parse().ok()?;
    if range_bounds.next().is_some() {
        return None;
    }
    let total: Option<u64> = if total_part.trim() == "*" {
        None
    } else {
        Some(total_part.trim().parse().ok()?)
    };
    if start > end || total.is_some_and(|total| total <= end) {
        return None;
    }
    Some(ContentRange { start, end, total })
}

fn content_range_matches(header: &str, expected_start: u64, max_end: u64, expected_total: u64) -> bool {
    parse_content_range(header).is_some_and(|range| {
        range.start == expected_start
            && range.end <= max_end
            && range.total == Some(expected_total)
    })
}

async fn audio_response_with_range(
    client: &reqwest::Client,
    url: &str,
    range: Option<&str>,
    cancel: &AtomicBool,
    youtube: bool,
) -> Result<(reqwest::Url, reqwest::Response)> {
    let mut location = reqwest::Url::parse(url).map_err(|_| "Invalid download URL.")?;
    for _ in 0..5 {
        if cancel.load(Ordering::Relaxed) {
            return Err("Download cancelled.".into());
        }
        if !download_location_allowed(&location, youtube) {
            return Err("Unsupported download location.".into());
        }
        let mut req = client.get(location.clone());
        if let Some(r) = range {
            req = req.header(reqwest::header::RANGE, r);
        }
        let response = tokio::time::timeout(Duration::from_secs(15), req.send())
            .await
            .map_err(|_| "Download connection timed out.")?
            .map_err(|e| format!("Could not connect to audio source: {e}"))?;
        if !response.status().is_redirection() {
            return Ok((location, response));
        }
        let redirect = response
            .headers()
            .get("location")
            .and_then(|header| header.to_str().ok())
            .ok_or("Invalid media redirect.")?;
        location = location
            .join(redirect)
            .map_err(|_| "Invalid media redirect.")?;
    }
    Err("Too many media redirects.".into())
}

#[allow(dead_code)]
async fn audio_response_for(
    client: &reqwest::Client,
    url: &str,
    cancel: &AtomicBool,
    youtube: bool,
) -> Result<reqwest::Response> {
    audio_response_with_range(client, url, None, cancel, youtube).await.map(|(_, res)| res)
}

fn validate_audio_file(path: &std::path::Path) -> Result<()> {
    lofty::probe::Probe::open(path)
        .and_then(|probe| Ok(probe.guess_file_type()?))
        .and_then(|probe| probe.read())
        .map_err(|_| "The downloaded file is not readable audio.".to_string())?;
    crate::audio_container::require_audio_only(path)?;
    Ok(())
}

async fn transfer_resumable_audio(
    client: &reqwest::Client,
    initial_url: &str,
    path: &std::path::Path,
    cancel: &AtomicBool,
    youtube: bool,
    on_progress: Option<&tauri::ipc::Channel<DownloadProgress>>,
) -> Result<()> {
    const MAX: u64 = 200 * 1024 * 1024;
    const CHUNK_SIZE: u64 = 2 * 1024 * 1024;
    const IDLE_TIMEOUT: Duration = Duration::from_secs(20);

    let mut existing_len = if path.exists() {
        fs::metadata(path).map(|m| m.len()).unwrap_or(0)
    } else {
        0
    };
    if existing_len > MAX {
        let _ = fs::remove_file(path);
        existing_len = 0;
    }

    let chunk_probe = format!("bytes={existing_len}-{}", existing_len + CHUNK_SIZE - 1);
    let (final_url, mut response) = audio_response_with_range(
        client,
        initial_url,
        Some(&chunk_probe),
        cancel,
        youtube,
    )
    .await?;

    if response.status() == reqwest::StatusCode::RANGE_NOT_SATISFIABLE && existing_len > 0 {
        let _ = fs::remove_file(path);
        existing_len = 0;
        let chunk_zero = format!("bytes=0-{}", CHUNK_SIZE - 1);
        let res = audio_response_with_range(client, initial_url, Some(&chunk_zero), cancel, youtube).await?;
        response = res.1;
    }

    let status = response.status();
    if status != reqwest::StatusCode::OK && status != reqwest::StatusCode::PARTIAL_CONTENT {
        return Err(format!("Audio transfer failed (HTTP {status}, 200 MB size limit)."));
    }

    let is_partial = status == reqwest::StatusCode::PARTIAL_CONTENT;
    let (supports_range, total_len, offset) = if is_partial {
        let cr_header = response
            .headers()
            .get("content-range")
            .and_then(|h| h.to_str().ok());
        let cr = cr_header.and_then(parse_content_range)
            .ok_or("206 Partial Content has an invalid Content-Range header.")?;
        let total = cr.total.ok_or("Server did not return total audio length.")?;
        if total > MAX {
            return Err(format!("Audio exceeds download limit ({total} > {MAX} bytes)."));
        }
        let expected_end = std::cmp::min(existing_len + CHUNK_SIZE - 1, total - 1);
        if !content_range_matches(cr_header.unwrap_or_default(), existing_len, expected_end, total)
            || response.content_length().is_some_and(|length| length != cr.end - cr.start + 1)
        {
            let _ = fs::remove_file(path);
            return Err("Audio server returned the wrong byte range.".into());
        }
        (true, total, existing_len)
    } else {
        if existing_len > 0 {
            let _ = fs::remove_file(path);
            existing_len = 0;
        }
        let total = response
            .content_length()
            .ok_or("Audio server did not provide content length.")?;
        if total > MAX {
            return Err(format!("Audio exceeds download limit ({total} > {MAX} bytes)."));
        }
        (false, total, 0)
    };

    if existing_len >= total_len && total_len > 0 {
        progress(on_progress, "validating", total_len, Some(total_len), 0.0);
        return validate_audio_file(path);
    }

    let mut file = fs::OpenOptions::new()
        .create(true)
        .write(true)
        .append(supports_range && offset > 0)
        .truncate(!supports_range || offset == 0)
        .open(path)
        .map_err(err)?;

    let mut received = offset;
    let started = std::time::Instant::now();
    let mut last_progress = started;

    progress(on_progress, "transferring", received, Some(total_len), 0.0);

    if !supports_range {
        while let Some(chunk) = match tokio::time::timeout(IDLE_TIMEOUT, response.chunk()).await {
            Err(_) => return Err("Download stalled: connection timed out waiting for data.".into()),
            Ok(c) => c.map_err(|e| format!("Download interrupted: {e}"))?,
        } {
            if cancel.load(Ordering::Relaxed) {
                return Err("Download cancelled.".into());
            }
            received += chunk.len() as u64;
            if received > MAX {
                return Err("Audio exceeds the 200 MB download limit.".into());
            }
            file.write_all(&chunk).map_err(err)?;
            if last_progress.elapsed() >= Duration::from_millis(200) {
                let bps = (received - offset) as f64 / started.elapsed().as_secs_f64().max(0.001);
                progress(on_progress, "transferring", received, Some(total_len), bps);
                last_progress = std::time::Instant::now();
            }
        }
    } else {
        let mut current_stream = response;
        let first_target = std::cmp::min(offset + CHUNK_SIZE, total_len);

        while received < first_target {
            if cancel.load(Ordering::Relaxed) {
                return Err("Download cancelled.".into());
            }
            let chunk = match tokio::time::timeout(IDLE_TIMEOUT, current_stream.chunk()).await {
                Err(_) => break,
                Ok(c) => match c {
                    Ok(Some(c)) => c,
                    _ => break,
                },
            };
            received += chunk.len() as u64;
            file.write_all(&chunk).map_err(err)?;
            if last_progress.elapsed() >= Duration::from_millis(200) {
                let bps = (received - offset) as f64 / started.elapsed().as_secs_f64().max(0.001);
                progress(on_progress, "transferring", received, Some(total_len), bps);
                last_progress = std::time::Instant::now();
            }
        }
        file.flush().map_err(err)?;

        while received < total_len {
            if cancel.load(Ordering::Relaxed) {
                return Err("Download cancelled.".into());
            }
            let chunk_end = std::cmp::min(received + CHUNK_SIZE - 1, total_len - 1);
            let mut chunk_downloaded = false;
            let mut last_error = String::new();

            for attempt in 0..3 {
                if cancel.load(Ordering::Relaxed) {
                    return Err("Download cancelled.".into());
                }
                if attempt > 0 {
                    let delay = Duration::from_millis(400 * (1 << attempt));
                    tokio::time::sleep(delay).await;
                }

                let range_str = format!("bytes={received}-{chunk_end}");
                let chunk_res = tokio::time::timeout(
                    IDLE_TIMEOUT,
                    client.get(final_url.clone()).header(reqwest::header::RANGE, range_str).send(),
                )
                .await;

                let mut chunk_resp = match chunk_res {
                    Ok(Ok(resp)) => resp,
                    Ok(Err(e)) => {
                        last_error = e.to_string();
                        continue;
                    }
                    Err(_) => {
                        last_error = "Connection timed out waiting for chunk.".into();
                        continue;
                    }
                };

                if chunk_resp.status() != reqwest::StatusCode::PARTIAL_CONTENT {
                    last_error = format!("HTTP {}", chunk_resp.status());
                    continue;
                }

                let range_header = chunk_resp.headers().get("content-range").and_then(|h| h.to_str().ok());
                let range = range_header.and_then(parse_content_range);
                if !range_header.is_some_and(|header| content_range_matches(header, received, chunk_end, total_len))
                    || range.as_ref().is_some_and(|range| chunk_resp.content_length().is_some_and(|length| length != range.end - range.start + 1))
                {
                    last_error = "Server returned an invalid byte range.".into();
                    continue;
                }

                let chunk_start_received = received;
                let mut chunk_success = true;

                loop {
                    let chunk_item = match tokio::time::timeout(IDLE_TIMEOUT, chunk_resp.chunk()).await {
                        Ok(Ok(Some(d))) => Some(d),
                        Ok(Ok(None)) => None,
                        Ok(Err(e)) => {
                            last_error = e.to_string();
                            chunk_success = false;
                            break;
                        }
                        Err(_) => {
                            last_error = "Chunk read timed out.".into();
                            chunk_success = false;
                            break;
                        }
                    };
                    let Some(data) = chunk_item else {
                        break;
                    };
                    if cancel.load(Ordering::Relaxed) {
                        return Err("Download cancelled.".into());
                    }
                    received += data.len() as u64;
                    if let Err(e) = file.write_all(&data) {
                        return Err(err(e));
                    }
                    if last_progress.elapsed() >= Duration::from_millis(200) {
                        let bps = (received - offset) as f64 / started.elapsed().as_secs_f64().max(0.001);
                        progress(on_progress, "transferring", received, Some(total_len), bps);
                        last_progress = std::time::Instant::now();
                    }
                }

                if chunk_success {
                    file.flush().map_err(err)?;
                    chunk_downloaded = true;
                    break;
                } else {
                    received = chunk_start_received;
                    let _ = file.seek(std::io::SeekFrom::Start(received));
                    let _ = file.set_len(received);
                }
            }

            if !chunk_downloaded {
                return Err(format!("Download failed at {received}/{total_len} bytes: {last_error}"));
            }
        }
    }

    if received != total_len {
        return Err(format!("Incomplete audio download ({received}/{total_len} bytes)."));
    }

    progress(on_progress, "validating", received, Some(total_len), (received - offset) as f64 / started.elapsed().as_secs_f64().max(0.001));
    file.sync_all().map_err(err)?;
    drop(file);

    validate_audio_file(path)
}

#[allow(dead_code)]
async fn transfer_audio(
    mut response: reqwest::Response,
    path: &std::path::Path,
    cancel: &AtomicBool,
    on_progress: Option<&tauri::ipc::Channel<DownloadProgress>>,
) -> Result<()> {
    const MAX: u64 = 200 * 1024 * 1024;
    const IDLE_TIMEOUT: Duration = Duration::from_secs(20);
    let status = response.status();
    if (status != reqwest::StatusCode::OK && status != reqwest::StatusCode::PARTIAL_CONTENT)
        || response.content_length().is_some_and(|bytes| bytes > MAX)
    {
        return Err(format!(
            "Audio transfer failed (HTTP {}, 200 MB size limit).",
            status
        ));
    }
    let expected = if status == reqwest::StatusCode::PARTIAL_CONTENT {
        let cr = response
            .headers()
            .get("content-range")
            .and_then(|h| h.to_str().ok())
            .and_then(parse_content_range);
        match cr {
            Some(cr) => cr.total.or_else(|| response.content_length()),
            None => return Err("206 Partial Content missing Content-Range header.".into()),
        }
    } else {
        response.content_length()
    };
    let mut file = fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(path)
        .map_err(err)?;
    let mut received = 0u64;
    let started = std::time::Instant::now();
    let mut last_progress = started;
    progress(on_progress, "transferring", 0, expected, 0.0);
    loop {
        if cancel.load(Ordering::Relaxed) {
            return Err("Download cancelled.".into());
        }
        let chunk = match tokio::time::timeout(IDLE_TIMEOUT, response.chunk()).await {
            Err(_) => return Err("Download stalled: connection timed out waiting for data.".into()),
            Ok(c) => c.map_err(|e| format!("Download stream interrupted: {e}"))?,
        };
        let Some(chunk) = chunk else {
            break;
        };
        received += chunk.len() as u64;
        if received > MAX {
            return Err("Audio exceeds the 200 MB download limit.".into());
        }
        file.write_all(&chunk).map_err(err)?;
        if last_progress.elapsed() >= Duration::from_millis(200) {
            progress(on_progress, "transferring", received, expected, received as f64 / started.elapsed().as_secs_f64().max(0.001));
            last_progress = std::time::Instant::now();
        }
    }
    if received == 0 || expected.is_some_and(|length| received != length) {
        return Err("The audio download was incomplete.".into());
    }
    progress(on_progress, "validating", received, expected, received as f64 / started.elapsed().as_secs_f64().max(0.001));
    file.sync_all().map_err(err)?;
    drop(file);
    validate_audio_file(path)?;
    if cancel.load(Ordering::Relaxed) {
        return Err("Download cancelled.".into());
    }
    Ok(())
}


#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadQueueEntry {
    pub track_id: String,
    pub collection_id: String,
    pub title: String,
    pub status: String,
    pub added_at: i64,
    #[serde(default)]
    pub track: Option<serde_json::Value>,
}

fn download_queue_entry(row: &rusqlite::Row<'_>) -> rusqlite::Result<DownloadQueueEntry> {
    let track_data: Option<String> = row.get(5)?;
    Ok(DownloadQueueEntry {
        track_id: row.get(0)?, collection_id: row.get(1)?, title: row.get(2)?,
        status: row.get(3)?, added_at: row.get(4)?,
        track: track_data.and_then(|data| serde_json::from_str(&data).ok()),
    })
}

#[tauri::command]
pub async fn get_download_queue(app: tauri::AppHandle, collection_id: Option<String>) -> Result<Vec<DownloadQueueEntry>> {
    work(app, move |_, db| {
        let mut sql = "SELECT track_id, collection_id, title, status, added_at, track_data FROM download_queue".to_string();
        if collection_id.is_some() {
            sql.push_str(" WHERE collection_id = ?1");
        }
        sql.push_str(" ORDER BY added_at ASC");
        let mut stmt = db.prepare(&sql).map_err(err)?;
        let rows = if let Some(ref cid) = collection_id {
            stmt.query_map([cid], download_queue_entry).map_err(err)?.collect::<std::result::Result<Vec<_>, _>>().map_err(err)?
        } else {
            stmt.query_map([], download_queue_entry).map_err(err)?.collect::<std::result::Result<Vec<_>, _>>().map_err(err)?
        };
        Ok(rows)
    }).await
}

#[tauri::command]
pub async fn save_download_queue(app: tauri::AppHandle, entries: Vec<DownloadQueueEntry>) -> Result<()> {
    work(app, move |_, db| {
        let tx = db.transaction().map_err(err)?;
        for entry in entries {
            if entry.track_id.is_empty() || entry.track_id.len() > 512 || entry.collection_id.len() > 512
                || entry.title.len() > 2048 || !matches!(entry.status.as_str(), "pending" | "downloading" | "completed" | "failed" | "paused")
            { return Err("Invalid download queue entry.".into()); }
            let track_data = entry.track.map(|track| {
                if !track.is_object() || track["id"].as_str() != Some(entry.track_id.as_str()) {
                    return Err("Download queue track identity does not match its entry.".to_string());
                }
                let encoded = serde_json::to_string(&track).map_err(crate::err)?;
                if encoded.len() > 128 * 1024 { return Err("Download queue track is too large.".into()); }
                Ok(encoded)
            }).transpose()?;
            tx.execute(
                "INSERT INTO download_queue (track_id, collection_id, title, status, added_at, track_data)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                 ON CONFLICT(track_id) DO UPDATE SET
                   collection_id=excluded.collection_id,
                   title=excluded.title,
                   status=excluded.status,
                   added_at=excluded.added_at,
                   track_data=COALESCE(excluded.track_data, download_queue.track_data)",
                params![entry.track_id, entry.collection_id, entry.title, entry.status, entry.added_at, track_data],
            ).map_err(err)?;
        }
        tx.commit().map_err(err)?;
        Ok(())
    }).await
}

#[tauri::command]
pub async fn update_download_queue_status(app: tauri::AppHandle, track_id: String, status: String) -> Result<()> {
    work(app, move |_, db| {
        db.execute(
            "UPDATE download_queue SET status=?1 WHERE track_id=?2",
            params![status, track_id],
        ).map_err(err)?;
        Ok(())
    }).await
}

#[tauri::command]
pub async fn clear_download_queue(app: tauri::AppHandle, collection_id: Option<String>) -> Result<()> {
    work(app, move |_, db| {
        if let Some(cid) = collection_id {
            db.execute("DELETE FROM download_queue WHERE collection_id = ?1", params![cid]).map_err(err)?;
        } else {
            db.execute("DELETE FROM download_queue", []).map_err(err)?;
        }
        Ok(())
    }).await
}
