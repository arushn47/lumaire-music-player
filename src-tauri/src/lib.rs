use lofty::{
    file::{AudioFile, TaggedFileExt},
    prelude::Accessor,
    probe::Probe,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{
    env, fs,
    path::{Path, PathBuf},
    sync::Mutex,
    time::Duration,
};
use tauri::{AppHandle, Manager, State};
use uuid::Uuid;

pub(crate) mod android;
#[cfg(target_os = "android")]
pub(crate) mod android_background;
#[cfg(target_os = "android")]
pub(crate) mod android_queue_state;
mod audio_container;
#[cfg(any(windows, test))]
mod offline_repair;
mod artwork_cache;
mod audio_analysis;
mod components;
pub(crate) mod catalog;
mod catalog_search;
mod brainz_catalog;
mod music_metadata;
mod apple_charts;
mod collection_io;
mod nearby;
mod device_sync;
mod playlist_link;
#[cfg(windows)]
mod lyric_overlay;
#[cfg(windows)]
mod taskbar;
mod downloads;
mod entity_artwork;
mod itunes_metadata;
mod lastfm_metadata;
pub(crate) mod listening;
mod lyric_identity;
mod lyrics_provider;
mod private_settings;
mod provider_http;
mod translation;
mod keyless_translation;
pub(crate) mod recording_metadata;
mod lyric_languages;
mod ytdlp;

pub(crate) struct Store(pub(crate) Mutex<Connection>);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VerifiedSource {
    #[serde(default)]
    pub(crate) user_selected: bool,
    pub(crate) source_id: String,
    pub(crate) source_provider: String,
    pub(crate) title: String,
    pub(crate) artist: Option<String>,
    pub(crate) duration: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Track {
    id: String,
    title: String,
    artist: String,
    album: String,
    duration: f64,
    file_name: String,
    missing: bool,
    format: String,
    #[serde(default)]
    source: Option<RemoteSource>,
    #[serde(default)]
    artwork_url: Option<String>,
    #[serde(default)]
    offline: bool,
    #[serde(default)]
    metadata_source_id: Option<String>,
    #[serde(default)]
    pub recording_metadata: Option<recording_metadata::RecordingMetadata>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RemoteSource {
    provider_id: String,
    source_id: String,
    page_url: String,
    license: String,
    license_url: String,
    attribution: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RemoteTrack {
    id: String,
    title: String,
    artist: String,
    album: String,
    duration: f64,
    file_name: String,
    missing: bool,
    format: String,
    source: RemoteSource,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ResolvedMedia {
    url: String,
    mime_type: String,
    license: String,
    license_url: String,
    attribution: String,
}

#[derive(Serialize)]
struct Snapshot {
    tracks: Vec<Track>,
    session: Option<serde_json::Value>,
}
#[derive(Serialize)]
struct Imported {
    tracks: Vec<Track>,
    warnings: Vec<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TextInput {
    text: String,
    file_name: String,
}

#[cfg(target_os = "android")]
#[tauri::command]
async fn import_audio(app: AppHandle, folder: bool) -> Result<Imported> {
    let _ = folder;
    let picked = android::call(&app, "pickAudio", serde_json::json!({})).await?;
    let paths: Vec<String> = serde_json::from_value(picked["paths"].clone()).map_err(err)?;
    work(app, move |app, db| {
        import_selected(app, db, paths.into_iter().map(PathBuf::from).collect())
    })
    .await
}

#[cfg(target_os = "android")]
#[tauri::command]
async fn pick_lyrics(app: AppHandle) -> Result<Option<TextInput>> {
    let picked = android::call(&app, "pickText", serde_json::json!({})).await?;
    if picked.is_null() {
        return Ok(None);
    }
    Ok(Some(TextInput {
        text: picked["text"]
            .as_str()
            .ok_or("Could not read selected text.")?
            .to_string(),
        file_name: picked["fileName"]
            .as_str()
            .unwrap_or("lyrics.txt")
            .to_string(),
    }))
}

#[cfg(target_os = "android")]
#[tauri::command]
async fn relink_audio(_app: AppHandle, id: String) -> Result<Option<Track>> {
    let _ = id;
    Err("Re-import the original audio through Add music in this Android prototype.".into())
}

#[cfg(target_os = "android")]
#[tauri::command]
async fn export_library(_app: AppHandle, session: serde_json::Value) -> Result<bool> {
    let _ = session;
    Err("Android backup export is not implemented in this prototype yet.".into())
}

#[cfg(target_os = "android")]
#[tauri::command]
async fn import_library(_app: AppHandle) -> Result<Option<Snapshot>> {
    Err("Android backup restore is not implemented in this prototype yet.".into())
}

type Result<T> = std::result::Result<T, String>;
fn err(_: impl std::fmt::Display) -> String {
    "The local library operation failed. Check available disk space and file permissions.".into()
}

fn initialize(db: &mut Connection) -> Result<()> {
    db.busy_timeout(Duration::from_secs(5)).map_err(err)?;
    db.execute_batch("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;")
        .map_err(err)?;
    let version: i64 = db
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .map_err(err)?;
    if version > 2 {
        return Err(
            "This library was created by a newer Lumaire version. Your data has been preserved."
                .into(),
        );
    }
    let tx = db.transaction().map_err(err)?;
    tx.execute_batch("CREATE TABLE IF NOT EXISTS tracks (id TEXT PRIMARY KEY, path TEXT UNIQUE, metadata TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS app_state (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS entity_artwork (identity TEXT PRIMARY KEY, metadata TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS verified_sources (catalog_id TEXT PRIMARY KEY, source_id TEXT NOT NULL, source_provider TEXT NOT NULL, title TEXT NOT NULL, artist TEXT, duration REAL, verified_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS download_queue (track_id TEXT PRIMARY KEY, collection_id TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL, added_at INTEGER NOT NULL, track_data TEXT);
      ").map_err(err)?;
    listening::initialize(&tx)?;
    let has_user_source = tx.prepare("PRAGMA table_info(verified_sources)").map_err(err)?
        .query_map([], |row| row.get::<_, String>(1)).map_err(err)?
        .collect::<std::result::Result<Vec<_>, _>>().map_err(err)?.iter().any(|name| name == "user_selected");
    if !has_user_source { tx.execute("ALTER TABLE verified_sources ADD COLUMN user_selected INTEGER NOT NULL DEFAULT 0", []).map_err(err)?; }
    let has_download_track_data = tx.prepare("PRAGMA table_info(download_queue)").map_err(err)?
        .query_map([], |row| row.get::<_, String>(1)).map_err(err)?
        .collect::<std::result::Result<Vec<_>, _>>().map_err(err)?.iter().any(|name| name == "track_data");
    if !has_download_track_data { tx.execute("ALTER TABLE download_queue ADD COLUMN track_data TEXT", []).map_err(err)?; }
    device_sync::initialize(&tx)?;
    keyless_translation::initialize(&tx)?;
    tx.execute("UPDATE download_queue SET status='pending' WHERE status='downloading'", []).map_err(err)?;
    tx.execute_batch("PRAGMA user_version=2;").map_err(err)?;
    tx.commit().map_err(err)
}

pub(crate) fn snapshot(db: &Connection) -> Result<Snapshot> {
    let mut stmt = db
        .prepare("SELECT metadata,path FROM tracks ORDER BY rowid")
        .map_err(err)?;
    let rows = stmt
        .query_map([], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?))
        })
        .map_err(err)?;
    let mut tracks = Vec::new();
    for row in rows {
        let (json, path) = row.map_err(err)?;
        let mut track: Track = serde_json::from_str(&json).map_err(err)?;
        if track.source.is_none() && track.artwork_url.is_none() {
            if let Some(metadata) = path.as_ref().and_then(|path| fs::metadata(path).ok()) {
                let stamp = metadata
                    .modified()
                    .ok()
                    .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|time| time.as_secs())
                    .unwrap_or(0);
                track.artwork_url =
                    Some(format!("local:{}?v={stamp}-{}", track.id, metadata.len()));
            }
        }
        track.missing = track.format != "catalog" && (track.source.is_none() || track.offline)
            && path.as_ref().is_none_or(|p| !Path::new(p).is_file());
        tracks.push(track);
    }
    let raw: Option<String> = db
        .query_row("SELECT data FROM app_state WHERE id=1", [], |r| r.get(0))
        .optional()
        .map_err(err)?;
    let session = raw
        .map(|s| serde_json::from_str(&s))
        .transpose()
        .map_err(err)?;
    Ok(Snapshot { tracks, session })
}

async fn work<T: Send + 'static>(
    app: AppHandle,
    f: impl FnOnce(&AppHandle, &mut Connection) -> Result<T> + Send + 'static,
) -> Result<T> {
    tauri::async_runtime::spawn_blocking(move || {
        let state: State<Store> = app.state();
        let mut db = state.inner().0.lock().map_err(err)?;
        f(&app, &mut db)
    })
    .await
    .map_err(err)?
}

fn allow(app: &AppHandle, path: &Path) -> Result<()> {
    app.asset_protocol_scope().allow_file(path).map_err(err)
}

fn inspect(path: &Path, id: String) -> Track {
    let file_name = path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    let stem = path
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    let mut track = Track {
        id,
        title: stem,
        artist: "Unknown artist".into(),
        album: "Local collection".into(),
        duration: 0.0,
        file_name,
        missing: false,
        format: path
            .extension()
            .unwrap_or_default()
            .to_string_lossy()
            .to_uppercase(),
        source: None,
        artwork_url: None,
        offline: false,
        metadata_source_id: None,
        recording_metadata: None,
    };
    if let Ok(file) = Probe::open(path).and_then(|p| p.read()) {
        track.duration = file.properties().duration().as_secs_f64();
        if let Some(tag) = file.primary_tag().or_else(|| file.first_tag()) {
            if !tag.pictures().is_empty() {
                let stamp = fs::metadata(path)
                    .ok()
                    .and_then(|metadata| metadata.modified().ok())
                    .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|time| time.as_secs())
                    .unwrap_or(0);
                track.artwork_url = Some(format!("local:{}?v={stamp}", track.id));
            }
            if let Some(v) = tag.title() {
                track.title = v.chars().take(1000).collect();
            }
            if let Some(v) = tag.artist() {
                track.artist = v.chars().take(1000).collect();
            }
            if let Some(v) = tag.album() {
                track.album = v.chars().take(1000).collect();
            }
        }
    }
    track
}

const COMMONS_API: &str = "https://commons.wikimedia.org/w/api.php";
const COMMONS_PROVIDER: &str = "wikimedia-commons";

fn commons_mime(info: &serde_json::Value) -> String {
    let mime = info["mime"]
        .as_str()
        .unwrap_or_default()
        .to_ascii_lowercase();
    if mime == "application/ogg" && info["mediatype"].as_str() == Some("AUDIO") {
        "audio/ogg".into()
    } else {
        mime
    }
}

fn commons_client() -> Result<reqwest::Client> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(12))
        .user_agent("Lumaire/0.1 (Wikimedia Commons audio discovery)")
        .build()
        .map_err(|_| "Could not start the online music connection.".to_string())
}

fn plain_metadata(value: &serde_json::Value) -> String {
    let html = value["value"].as_str().unwrap_or_default();
    let mut output = String::with_capacity(html.len().min(1000));
    let mut inside_tag = false;
    for ch in html.chars() {
        match ch {
            '<' => inside_tag = true,
            '>' => inside_tag = false,
            _ if !inside_tag => output.push(ch),
            _ => {}
        }
    }
    output
        .replace("&amp;", "&")
        .replace("&#39;", "'")
        .replace("&quot;", "\"")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .trim()
        .chars()
        .take(500)
        .collect()
}

fn libre_license(license: &str) -> bool {
    license.starts_with("cc-by-")
        || license.starts_with("cc-by-sa-")
        || license == "cc0"
        || license == "cc-zero"
        || license.starts_with("pd-")
        || license == "public domain"
}

fn licensed_audio(mime: &str, license: &str) -> bool {
    libre_license(license)
        && matches!(
            mime,
            "audio/mpeg" | "audio/ogg" | "audio/wav" | "audio/flac"
        )
}

fn commons_track(page: &serde_json::Value) -> Option<RemoteTrack> {
    let page_id = page["pageid"].as_i64()?;
    let file_title = page["title"].as_str()?;
    let info = page["imageinfo"].as_array()?.first()?;
    let mime = commons_mime(info);
    let metadata = &info["extmetadata"];
    let license = metadata["License"]
        .get("value")?
        .as_str()?
        .to_ascii_lowercase();
    if !licensed_audio(&mime, &license) {
        return None;
    }
    let page_url = info["descriptionurl"].as_str()?;
    if !page_url.starts_with("https://commons.wikimedia.org/wiki/File:") {
        return None;
    }
    let object_name = plain_metadata(&metadata["ObjectName"]);
    let title = if object_name.is_empty() {
        file_title
            .strip_prefix("File:")
            .unwrap_or(file_title)
            .to_string()
    } else {
        object_name
    };
    let artist = ["Artist", "Author"]
        .iter()
        .map(|key| plain_metadata(&metadata[*key]))
        .find(|value| !value.is_empty())
        .unwrap_or_else(|| "Unknown artist".into());
    let credit = plain_metadata(&metadata["Credit"]);
    let attribution = if credit.is_empty() || credit == artist {
        artist.clone()
    } else {
        format!("{artist} · {credit}")
    };
    let license_name = plain_metadata(&metadata["LicenseShortName"]);
    let license_url = plain_metadata(&metadata["LicenseUrl"]);
    let duration = info["duration"].as_f64().unwrap_or(0.0);
    let extension = match mime.as_str() {
        "audio/mpeg" => "MP3",
        "audio/ogg" => "OGG",
        "audio/wav" => "WAV",
        "audio/flac" => "FLAC",
        _ => return None,
    };
    Some(RemoteTrack {
        id: format!("{COMMONS_PROVIDER}:{page_id}"),
        title,
        artist,
        album: "Wikimedia Commons · individually licensed".into(),
        duration,
        file_name: file_title
            .strip_prefix("File:")
            .unwrap_or(file_title)
            .into(),
        missing: false,
        format: extension.into(),
        source: RemoteSource {
            provider_id: COMMONS_PROVIDER.into(),
            source_id: page_id.to_string(),
            page_url: page_url.into(),
            license: if license_name.is_empty() {
                license
            } else {
                license_name
            },
            license_url,
            attribution,
        },
    })
}

#[tauri::command]
async fn search_commons_audio(query: String) -> Result<Vec<RemoteTrack>> {
    let query = query.trim();
    if query.len() < 2 || query.len() > 200 {
        return Err("Enter at least two characters to search.".into());
    }
    let response = commons_client()?
        .get(COMMONS_API)
        .query(&[
            ("action", "query"),
            ("generator", "search"),
            ("gsrnamespace", "6"),
            ("gsrlimit", "10"),
            ("gsrsearch", &format!("filetype:audio {query}")),
            ("prop", "imageinfo"),
            ("iiprop", "url|mime|mediatype|size|metadata|extmetadata"),
            ("iiurlwidth", "0"),
            ("format", "json"),
        ])
        .send()
        .await
        .map_err(|_| {
            "Wikimedia Commons could not be reached. Check your connection and retry.".to_string()
        })?;
    if !response.status().is_success() {
        return Err("Wikimedia Commons search is temporarily unavailable.".into());
    }
    if response.content_length().is_some_and(|n| n > 2_000_000) {
        return Err("The music search response exceeded its size limit.".into());
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|_| "The music search response could not be read.".to_string())?;
    if bytes.len() > 2_000_000 {
        return Err("The music search response exceeded its size limit.".into());
    }
    let body: serde_json::Value = serde_json::from_slice(&bytes)
        .map_err(|_| "Wikimedia Commons returned an unreadable search response.".to_string())?;
    let mut results = body["query"]["pages"]
        .as_object()
        .into_iter()
        .flat_map(|pages| pages.values())
        .filter_map(commons_track)
        .filter(|track| track.duration > 0.0 && track.duration.is_finite())
        .collect::<Vec<_>>();
    results.sort_by(|a, b| a.title.to_lowercase().cmp(&b.title.to_lowercase()));
    results.truncate(20);
    Ok(results)
}

pub(crate) async fn resolve_commons_audio_inner(source_id: String) -> Result<ResolvedMedia> {
    let page_id: i64 = source_id
        .parse()
        .map_err(|_| "This online track identity is invalid.".to_string())?;
    if page_id <= 0 {
        return Err("This online track identity is invalid.".into());
    }
    let response = commons_client()?
        .get(COMMONS_API)
        .query(&[
            ("action", "query"),
            ("pageids", &page_id.to_string()),
            ("prop", "imageinfo"),
            ("iiprop", "url|mime|mediatype|extmetadata"),
            ("format", "json"),
        ])
        .send()
        .await
        .map_err(|_| {
            "This Commons track could not be refreshed. Check your connection and retry."
                .to_string()
        })?;
    if !response.status().is_success() {
        return Err("This Commons track is temporarily unavailable.".into());
    }
    let body: serde_json::Value = response
        .json()
        .await
        .map_err(|_| "Commons returned an unreadable track response.".to_string())?;
    let page = &body["query"]["pages"][page_id.to_string()];
    let info = page["imageinfo"]
        .as_array()
        .and_then(|items| items.first())
        .ok_or_else(|| "This track is no longer available on Wikimedia Commons.".to_string())?;
    let mime = commons_mime(info);
    let license = info["extmetadata"]["License"]
        .get("value")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if !licensed_audio(&mime, &license) {
        return Err(
            "This Commons file has no supported audio format or recognized reuse license.".into(),
        );
    }
    let url = info["url"].as_str().unwrap_or_default();
    if !url.starts_with("https://upload.wikimedia.org/") {
        return Err("Commons returned an unsupported media location.".into());
    }
    Ok(ResolvedMedia {
        url: url.into(),
        mime_type: mime,
        license: plain_metadata(&info["extmetadata"]["LicenseShortName"]),
        license_url: plain_metadata(&info["extmetadata"]["LicenseUrl"]),
        attribution: plain_metadata(&info["extmetadata"]["Artist"]),
    })
}

#[tauri::command]
async fn resolve_commons_audio(source_id: String) -> Result<ResolvedMedia> {
    resolve_commons_audio_inner(source_id).await
}
fn is_audio(path: &Path) -> bool {
    path.extension().and_then(|s| s.to_str()).is_some_and(|s| {
        ["mp3", "wav", "flac", "ogg", "m4a", "aac", "opus"]
            .contains(&s.to_ascii_lowercase().as_str())
    })
}

// Deterministic native I/O for end-to-end tests. Compiled out of release builds;
// only a launch-time environment variable can enable it, never a web command.
#[cfg(not(target_os = "android"))]
fn test_picker(kind: &str) -> Option<Option<PathBuf>> {
    #[cfg(debug_assertions)]
    if let Some(root) = std::env::var_os("LUMAIRE_TEST_PICKER") {
        let root = PathBuf::from(root);
        let name = fs::read_to_string(root.join(format!("next-{kind}"))).ok()?;
        let name = name.trim();
        if name == "CANCEL" {
            return Some(None);
        }
        if Path::new(name).components().count() != 1 || name.contains(['/', '\\']) {
            return Some(None);
        }
        return Some(Some(root.join(name)));
    }
    let _ = kind;
    None
}
#[cfg(not(target_os = "android"))]
fn pick_audio_file(title: &str) -> Option<PathBuf> {
    if let Some(path) = test_picker("audio") {
        return path;
    }
    rfd::FileDialog::new()
        .set_title(title)
        .add_filter(
            "Audio",
            &["mp3", "wav", "flac", "ogg", "m4a", "aac", "opus"],
        )
        .pick_file()
}

// Only the native picker can introduce file paths. The renderer receives opaque track IDs.
fn import_selected(app: &AppHandle, db: &mut Connection, paths: Vec<PathBuf>) -> Result<Imported> {
    let mut tracks = Vec::new();
    let mut warnings = Vec::new();
    let tx = db.transaction().map_err(err)?;
    for path in paths.into_iter().take(10000) {
        let Ok(path) = path.canonicalize() else {
            warnings.push("A selected file could not be read.".into());
            continue;
        };
        if !is_audio(&path) || !path.is_file() {
            continue;
        }
        let path_text = path.to_string_lossy().to_string();
        let existing: Option<(String, String)> = tx
            .query_row(
                "SELECT id,metadata FROM tracks WHERE path=?1",
                [&path_text],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(err)?;
        let track = if let Some((_, metadata)) = existing {
            serde_json::from_str(&metadata).map_err(err)?
        } else {
            inspect(&path, Uuid::new_v4().to_string())
        };
        allow(app, &path)?;
        tx.execute("INSERT INTO tracks(id,path,metadata) VALUES(?1,?2,?3) ON CONFLICT(id) DO UPDATE SET metadata=excluded.metadata",params![track.id,path_text,serde_json::to_string(&track).map_err(err)?]).map_err(err)?;
        if !tracks.iter().any(|t: &Track| t.id == track.id) {
            tracks.push(track);
        }
    }
    tx.commit().map_err(err)?;
    Ok(Imported { tracks, warnings })
}

#[tauri::command]
async fn load_library(app: AppHandle) -> Result<Snapshot> {
    work(app, |_, db| snapshot(db)).await
}

// Only stable provider identity is accepted; local paths and expiring stream
// locations cannot be introduced through this command.
fn save_remote(db: &Connection, mut track: Track) -> Result<Track> {
    let source = track
        .source
        .as_ref()
        .ok_or("A saved online track needs a source.")?;
    let valid_id = match source.provider_id.as_str() {
        "youtube" => {
            source.source_id.len() == 11
                && source
                    .source_id
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
        }
        "wikimedia-commons" => source.source_id.parse::<u64>().is_ok_and(|id| id > 0),
        _ => false,
    };
    if !valid_id
        || track.id != format!("{}:{}", source.provider_id, source.source_id)
        || track.title.trim().is_empty()
        || track.title.len() > 4000
        || track.artist.len() > 4000
        || track.album.len() > 4000
        || !track.duration.is_finite()
        || track.duration < 0.0
    {
        return Err("Invalid online track information.".into());
    }
    if track.metadata_source_id.as_ref().is_some_and(|id| !catalog::valid_catalog_id(id)) {
        return Err("Invalid catalogue identity.".into());
    }
    track.missing = false;
    // Derive the source page rather than trusting renderer-provided locations.
    let source = track.source.as_mut().unwrap();
    source.page_url = if source.provider_id == "youtube" {
        format!("https://www.youtube.com/watch?v={}", source.source_id)
    } else {
        format!("https://commons.wikimedia.org/?curid={}", source.source_id)
    };
    track.artwork_url = track.artwork_url.filter(|url| {
        reqwest::Url::parse(url).is_ok_and(|url| {
            url.scheme() == "https"
                && url.host_str().is_some_and(|host| {
                    matches!(
                        host,
                        "i.ytimg.com"
                            | "i.scdn.co"
                            | "upload.wikimedia.org"
                            | "coverartarchive.org"
                            | "lastfm-img.freetls.fastly.net"
                            | "c.saavncdn.com"
                    ) || host.ends_with(".mzstatic.com")
                })
        })
    });
    let json = serde_json::to_string(&track).map_err(err)?;
    if json.len() > 32000 {
        return Err("Online track metadata is too large.".into());
    }
    let previous: Option<(Option<String>, String)> = db
        .query_row(
            "SELECT path,metadata FROM tracks WHERE id=?1",
            [&track.id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(err)?;
    if let Some((path, metadata)) = previous {
        let stored: Track = serde_json::from_str(&metadata).map_err(err)?;
        if path.is_some() && (!stored.offline || stored.source.is_none()) {
            return Err("This identity belongs to a linked local file.".into());
        }
        track.offline = stored.offline;
    } else {
        track.offline = false;
    }
    let json = serde_json::to_string(&track).map_err(err)?;
    let written = db.execute("INSERT INTO tracks(id,path,metadata) VALUES(?1,NULL,?2) ON CONFLICT(id) DO UPDATE SET metadata=excluded.metadata",
        params![track.id, json]).map_err(err)?;
    if written == 0 {
        return Err("This track identity already belongs to a linked local file.".into());
    }
    Ok(track)
}

#[tauri::command]
async fn save_online_track(
    app: AppHandle,
    track: Track,
    update_only: Option<bool>,
) -> Result<Track> {
    work(app, move |_, db| {
        if update_only.unwrap_or(false)
            && !db
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM tracks WHERE id=?1)",
                    [&track.id],
                    |row| row.get::<_, bool>(0),
                )
                .map_err(err)?
        {
            return Err("This track has been removed from the library.".into());
        }
        save_remote(db, track)
    })
    .await
}
#[tauri::command]
#[cfg(not(target_os = "android"))]
async fn import_audio(app: AppHandle, folder: bool) -> Result<Imported> {
    // Dialog and metadata reads run outside the UI thread.
    work(app, move |app, db| {
        let paths = if let Some(path) = test_picker("audio") {
            path.into_iter().collect()
        } else if folder {
            let Some(root) = rfd::FileDialog::new()
                .set_title("Choose a music folder")
                .pick_folder()
            else {
                return Ok(Imported {
                    tracks: vec![],
                    warnings: vec![],
                });
            };
            walkdir::WalkDir::new(root)
                .follow_links(false)
                .into_iter()
                .filter_map(|e| e.ok())
                .filter(|e| e.file_type().is_file() && is_audio(e.path()))
                .take(10000)
                .map(|e| e.into_path())
                .collect()
        } else {
            rfd::FileDialog::new()
                .set_title("Add music to Lumaire")
                .add_filter(
                    "Audio",
                    &["mp3", "wav", "flac", "ogg", "m4a", "aac", "opus"],
                )
                .pick_files()
                .unwrap_or_default()
        };
        import_selected(app, db, paths)
    })
    .await
}
pub(crate) async fn media_path_inner(app: AppHandle, id: String) -> Result<String> {
    work(app, move |app, db| {
        let stored: Option<String> = db
            .query_row("SELECT path FROM tracks WHERE id=?1", [id], |r| r.get(0))
            .optional()
            .map_err(err)?
            .flatten();
        let Some(path) = stored else {
            return Err(
                "This file needs to be relinked. Choose its location from the track menu.".into(),
            );
        };
        let path = Path::new(&path).canonicalize().map_err(|_| {
            "The file has moved or is unavailable. Use Relink to choose it again.".to_string()
        })?;
        allow(app, &path)?;
        Ok(path.to_string_lossy().into_owned())
    })
    .await
}

#[tauri::command]
async fn media_path(app: AppHandle, id: String) -> Result<String> {
    media_path_inner(app, id).await
}
#[tauri::command]
#[cfg(not(target_os = "android"))]
async fn relink_audio(app: AppHandle, id: String) -> Result<Option<Track>> {
    work(app,move |app,db|{
        let exists:bool=db.query_row("SELECT EXISTS(SELECT 1 FROM tracks WHERE id=?1)",[&id],|r|r.get(0)).map_err(err)?;
        if !exists {return Err("The track no longer exists.".into());}
        let Some(path)=pick_audio_file("Relink this recording — choose the matching audio file") else {return Ok(None);};
        let path=path.canonicalize().map_err(err)?;
        if !is_audio(&path) {return Err("Choose an audio file.".into());}
        allow(app,&path)?;
        let track=inspect(&path,id.clone());
        db.execute("UPDATE tracks SET path=?1,metadata=?2 WHERE id=?3",params![path.to_string_lossy(),serde_json::to_string(&track).map_err(err)?,id]).map_err(|_|"That file is already in your library. Choose the matching recording, or use the existing entry.".to_string())?;
        Ok(Some(track))
    }).await
}

pub(crate) fn write_session_transaction(db: &Connection, session: &serde_json::Value) -> Result<()> {
    validate_session(session)?;
    let json = serde_json::to_string(session).map_err(err)?;
    if json.len() > 20 * 1024 * 1024 {
        return Err("Library text is too large to save (20 MB limit).".into());
    }
    device_sync::persist_session_cells(db, session)?;
    db.execute(
        "INSERT INTO app_state(id,data) VALUES(1,?1) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
        [json],
    )
    .map_err(err)?;
    Ok(())
}

pub(crate) fn write_session(db: &mut Connection, session: &serde_json::Value) -> Result<()> {
    let tx = db.transaction().map_err(err)?;
    write_session_transaction(&tx, session)?;
    tx.commit().map_err(err)
}

pub(crate) async fn get_verified_source_inner(app: AppHandle, catalog_id: String) -> Result<Option<VerifiedSource>> {
    work(app, move |_, db| {
        db.query_row(
            "SELECT source_id, source_provider, title, artist, duration, user_selected FROM verified_sources WHERE catalog_id=?1",
            [&catalog_id],
            |row| Ok(VerifiedSource {
                source_id: row.get(0)?, source_provider: row.get(1)?, title: row.get(2)?,
                artist: row.get(3)?, duration: row.get(4)?, user_selected: row.get(5)?,
            }),
        ).optional().map_err(err)
    }).await
}

#[tauri::command]
async fn get_verified_source(app: AppHandle, catalog_id: String) -> Result<Option<VerifiedSource>> {
    get_verified_source_inner(app, catalog_id).await
}

pub(crate) async fn set_verified_source_inner(app: AppHandle, catalog_id: String, source: VerifiedSource) -> Result<()> {
    if catalog_id.is_empty() || catalog_id.len() > 512 || source.source_id.is_empty() || source.source_id.len() > 512
        || source.source_provider.len() > 64 || source.title.len() > 2048
        || source.artist.as_ref().is_some_and(|value| value.len() > 2048)
        || source.duration.is_some_and(|value| !value.is_finite() || value < 0.0 || value > 86_400.0)
    { return Err("Invalid verified source.".into()); }
    work(app, move |_, db| {
        db.execute(
            "INSERT INTO verified_sources(catalog_id,source_id,source_provider,title,artist,duration,verified_at,user_selected) VALUES(?1,?2,?3,?4,?5,?6,unixepoch(),?7) ON CONFLICT(catalog_id) DO UPDATE SET source_id=excluded.source_id,source_provider=excluded.source_provider,title=excluded.title,artist=excluded.artist,duration=excluded.duration,verified_at=excluded.verified_at,user_selected=excluded.user_selected",
            params![catalog_id, source.source_id, source.source_provider, source.title, source.artist, source.duration, source.user_selected],
        ).map_err(err)?;
        Ok(())
    }).await
}

#[tauri::command]
async fn set_verified_source(app: AppHandle, catalog_id: String, source: VerifiedSource) -> Result<()> {
    set_verified_source_inner(app, catalog_id, source).await
}

#[tauri::command]
async fn delete_verified_source(app: AppHandle, catalog_id: String) -> Result<()> {
    work(app, move |_, db| { db.execute("DELETE FROM verified_sources WHERE catalog_id=?1", [catalog_id]).map_err(err)?; Ok(()) }).await
}

#[tauri::command]
async fn save_session(app: AppHandle, session: serde_json::Value) -> Result<()> {
    work(app, move |_, db| write_session(db, &session)).await
}

fn remove_track_data(
    db: &mut Connection,
    id: &str,
    mut session: serde_json::Value,
) -> Result<Snapshot> {
    validate_session(&session)?;
    let old_index = session["queue"]
        .as_array()
        .unwrap()
        .iter()
        .position(|entry| entry["id"] == session["currentId"])
        .unwrap_or(0);
    for key in ["queue", "history"] {
        session[key]
            .as_array_mut()
            .unwrap()
            .retain(|entry| entry["trackId"].as_str() != Some(id));
    }
    if let Some(metadata) = session
        .get_mut("queueTracks")
        .and_then(|value| value.as_object_mut())
    {
        metadata.remove(id);
    }
    session["favorites"]
        .as_array_mut()
        .unwrap()
        .retain(|entry| entry.as_str() != Some(id));
    for playlist in session["playlists"].as_array_mut().unwrap() {
        if let Some(items) = playlist["items"].as_array_mut() {
            items.retain(|entry| entry["trackId"].as_str() != Some(id));
        }
    }
    if let Some(lyrics) = session["lyrics"].as_object_mut() {
        lyrics.remove(id);
    }
    let queue = session["queue"].as_array().unwrap();
    if !queue
        .iter()
        .any(|entry| entry["id"] == session["currentId"])
    {
        session["currentId"] = queue
            .get(old_index.min(queue.len().saturating_sub(1)))
            .map(|entry| entry["id"].clone())
            .unwrap_or(serde_json::Value::Null);
        session["position"] = serde_json::json!(0);
    }
    let json = serde_json::to_string(&session).map_err(err)?;
    if json.len() > 20 * 1024 * 1024 {
        return Err("Library text exceeds 20 MB.".into());
    }
    let tx = db.transaction().map_err(err)?;
    let metadata: Option<String> = tx
        .query_row("SELECT metadata FROM tracks WHERE id=?1", [id], |row| {
            row.get(0)
        })
        .optional()
        .map_err(err)?;
    if metadata
        .as_deref()
        .map(serde_json::from_str::<Track>)
        .transpose()
        .map_err(err)?
        .is_some_and(|track| track.offline)
    {
        return Err("Delete the app-owned offline copy before removing this track.".into());
    }
    if tx
        .execute("DELETE FROM tracks WHERE id=?1", [id])
        .map_err(err)?
        == 0
    {
        return Err("This track is no longer in the library.".into());
    }
    device_sync::persist_session_cells(&tx, &session)?;
    tx.execute("INSERT INTO app_state(id,data) VALUES(1,?1) ON CONFLICT(id) DO UPDATE SET data=excluded.data", [json]).map_err(err)?;
    tx.commit().map_err(err)?;
    // This operation deliberately does not delete or move any audio file.
    snapshot(db)
}

#[tauri::command]
async fn remove_track(app: AppHandle, id: String, session: serde_json::Value) -> Result<Snapshot> {
    work(app, move |_, db| remove_track_data(db, &id, session)).await
}
pub(crate) fn validate_session(s: &serde_json::Value) -> Result<()> {
    if !s.is_object()
        || !s["queue"].is_array()
        || !s["playlists"].is_array()
        || !s["settings"].is_object()
    {
        return Err("Invalid library data. The previous library was preserved.".into());
    }
    for key in ["queue", "playlists", "favorites", "history"] {
        if s[key].as_array().is_none_or(|a| a.len() > 50000) {
            return Err("Invalid or oversized library data.".into());
        }
    }
    Ok(())
}
#[cfg(not(target_os = "android"))]
fn read_text(path: &Path, limit: u64) -> Result<String> {
    if fs::metadata(path).map_err(err)?.len() > limit {
        return Err("This text file exceeds the import size limit.".into());
    }
    fs::read_to_string(path).map_err(|_| {
        "Use a UTF-8 encoded text file. The selected file could not be decoded.".into()
    })
}
#[tauri::command]
#[cfg(not(target_os = "android"))]
async fn pick_lyrics(app: AppHandle) -> Result<Option<TextInput>> {
    work(app, |_, _| {
        let Some(path) = test_picker("lyrics").unwrap_or_else(|| {
            rfd::FileDialog::new()
                .set_title("Attach authorized lyrics or supplied text")
                .add_filter("Lyrics", &["lrc", "txt"])
                .pick_file()
        }) else {
            return Ok(None);
        };
        Ok(Some(TextInput {
            text: read_text(&path, 1_048_576)?,
            file_name: path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned(),
        }))
    })
    .await
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
enum LyricResult {
    #[serde(rename = "synced")]
    Synced {
        lrc: String,
        matched: Option<lyrics_provider::MatchInfo>,
    },
    #[serde(rename = "plain")]
    Plain {
        text: String,
        matched: Option<lyrics_provider::MatchInfo>,
    },
    #[serde(rename = "instrumental")]
    Instrumental,
    #[serde(rename = "not_found")]
    NotFound,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CanonicalMetadata {
    title: String,
    artist: String,
    album: String,
    duration: Option<f64>,
    source_id: Option<String>,
    artwork_url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct MusicBrainzResponse {
    recordings: Vec<MusicBrainzRecording>,
}

#[derive(Debug, Deserialize)]
struct MusicBrainzRecording {
    id: String,
    title: String,
    score: Option<u32>,
    length: Option<u64>,
    #[serde(rename = "artist-credit")]
    artist_credit: Option<Vec<MusicBrainzArtistCredit>>,
    releases: Option<Vec<MusicBrainzRelease>>,
}

#[derive(Debug, Deserialize)]
struct MusicBrainzArtistCredit {
    name: String,
}

#[derive(Debug, Deserialize)]
struct MusicBrainzRelease {
    id: Option<String>,
    title: String,
}

fn metadata_candidate_matches(
    recording: &MusicBrainzRecording,
    title: &str,
    artist: &str,
    duration: f64,
) -> bool {
    let recording_artist = recording
        .artist_credit
        .as_ref()
        .map(|credits| {
            credits
                .iter()
                .map(|credit| credit.name.as_str())
                .collect::<Vec<_>>()
                .join(", ")
        })
        .unwrap_or_default();
    let title_matches = lyric_identity::title(&recording.title) == lyric_identity::title(title);
    let artist_matches = lyric_identity::primary_artist(artist).is_empty()
        || lyric_identity::artists_match(&recording_artist, artist);
    let duration_matches = duration <= 0.0
        || recording.length.is_none()
        || ((recording.length.unwrap_or_default() as f64 / 1000.0) - duration).abs() <= 10.0;
    title_matches && artist_matches && duration_matches && recording.score.unwrap_or(0) >= 80
}

fn canonical_metadata(
    recording: &MusicBrainzRecording,
    fallback_artist: &str,
) -> CanonicalMetadata {
    let release = recording
        .releases
        .as_ref()
        .and_then(|releases| releases.first());
    CanonicalMetadata {
        title: recording.title.clone(),
        artist: recording
            .artist_credit
            .as_ref()
            .filter(|credits| !credits.is_empty())
            .map(|credits| {
                credits
                    .iter()
                    .map(|credit| credit.name.as_str())
                    .collect::<Vec<_>>()
                    .join(", ")
            })
            .unwrap_or_else(|| fallback_artist.to_string()),
        album: release
            .map(|release| release.title.clone())
            .unwrap_or_default(),
        duration: recording.length.map(|length| length as f64 / 1000.0),
        source_id: Some(recording.id.clone()),
        artwork_url: release
            .and_then(|release| release.id.as_ref())
            .and_then(|id| Uuid::parse_str(id).ok())
            .map(|id| format!("https://coverartarchive.org/release/{id}/front-500")),
    }
}

#[tauri::command]
async fn lookup_metadata(
    title: String,
    artist: String,
    duration: f64,
) -> Result<Option<CanonicalMetadata>> {
    if !duration.is_finite() || title.len() > 2000 || artist.len() > 2000 {
        return Err("Invalid metadata lookup information.".into());
    }
    let prepared_title = lyric_identity::query_title(&title);
    let (clean_artist, clean_title) = clean_artist_for_lyrics(&artist, &prepared_title);
    if clean_title.is_empty() {
        return Ok(None);
    }
    let partial = match lastfm_metadata::lookup(&clean_title, &clean_artist, duration).await {
        Ok(Some(metadata)) if !metadata.album.is_empty() => return Ok(Some(metadata)),
        Ok(metadata) => metadata,
        Err(error) => {
            eprintln!("[Metadata] {error} Trying MusicBrainz.");
            None
        }
    };
    match itunes_metadata::lookup(&clean_title, &clean_artist, duration).await {
        Ok(Some(metadata)) => return Ok(Some(metadata)),
        Ok(None) => (),
        Err(error) => eprintln!("[Metadata] {error} Trying MusicBrainz."),
    }
    match lookup_musicbrainz(clean_title, clean_artist, duration).await {
        Ok(Some(metadata)) => Ok(Some(metadata)),
        Ok(None) => Ok(partial),
        Err(_) if partial.is_some() => Ok(partial),
        Err(error) => Err(error),
    }
}

async fn lookup_musicbrainz(
    clean_title: String,
    clean_artist: String,
    duration: f64,
) -> Result<Option<CanonicalMetadata>> {
    // MusicBrainz requires at most one request/second. Hold this gate across
    // retries and enforce a gap after every lookup, including failed requests.
    static GATE: tokio::sync::Mutex<Option<tokio::time::Instant>> =
        tokio::sync::Mutex::const_new(None);
    let mut last = GATE.lock().await;
    if let Some(previous) = *last {
        tokio::time::sleep_until(previous + Duration::from_millis(1100)).await;
    }
    let response = provider_http::get(
        "https://musicbrainz.org/ws/2/recording/",
        &[
            (
                "query",
                if lyric_identity::primary_artist(&clean_artist).is_empty() {
                    format!("recording:\"{}\"", clean_title.replace(['"', '\\'], " "))
                } else {
                    format!(
                        "recording:\"{}\" AND artist:\"{}\"",
                        clean_title.replace(['"', '\\'], " "),
                        lyric_identity::primary_artist(&clean_artist).replace(['"', '\\'], " ")
                    )
                },
            ),
            ("fmt", "json".into()),
            ("limit", "25".into()),
        ],
    )
    .await;
    *last = Some(tokio::time::Instant::now());
    let response = response?;
    if !response.status().is_success() {
        return Err(format!(
            "MusicBrainz is unavailable (HTTP {}).",
            response.status()
        ));
    }
    let body: MusicBrainzResponse = response.json().await.map_err(|e| e.to_string())?;
    let candidates: Vec<_> = body
        .recordings
        .iter()
        .filter(|recording| {
            metadata_candidate_matches(recording, &clean_title, &clean_artist, duration)
        })
        .collect();
    let Some(recording) = candidates.first() else {
        return Ok(None);
    };
    if lyric_identity::primary_artist(&clean_artist).is_empty() {
        let performer = |r: &MusicBrainzRecording| {
            r.artist_credit
                .as_ref()
                .map(|credits| {
                    credits
                        .iter()
                        .map(|c| c.name.as_str())
                        .collect::<Vec<_>>()
                        .join(", ")
                })
                .unwrap_or_default()
        };
        if duration <= 0.0
            || recording.length.is_none()
            || candidates.iter().any(|candidate| {
                !lyric_identity::artists_match(&performer(recording), &performer(candidate))
            })
        {
            return Ok(None);
        }
    }
    Ok(Some(canonical_metadata(recording, &clean_artist)))
}

/// Clean YouTube title by removing common video metadata suffixes
fn clean_title_for_lyrics(title: &str) -> String {
    let patterns = [
        "(Official Video)",
        "(Official Music Video)",
        "(Official Audio)",
        "(Lyric Video)",
        "(Lyrics)",
        "[Official Video]",
        "[Official Music Video]",
        "[Official Audio]",
        "[Lyric Video]",
        "[Lyrics]",
        "(Audio)",
        "[Audio]",
        "(HD)",
        "[HD]",
        "(HQ)",
        "[HQ]",
        "(4K)",
        "[4K]",
        "- Topic",
    ];

    let mut cleaned = title.to_string();
    for pattern in &patterns {
        cleaned = remove_case_insensitive(&cleaned, pattern);
    }

    if let Some((song, _)) = cleaned.split_once(" | ") {
        cleaned = song.to_string();
    }

    let lower = cleaned.to_ascii_lowercase();
    for marker in [" ft. ", " feat. ", " featuring "] {
        if let Some(index) = lower.find(marker) {
            cleaned.truncate(index);
            break;
        }
    }
    if cleaned.to_ascii_lowercase().ends_with(" from youtube") {
        let end = cleaned.len() - " from youtube".len();
        cleaned.truncate(end);
    }

    // Remove excessive whitespace
    cleaned = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    cleaned.trim().to_string()
}

fn remove_case_insensitive(value: &str, pattern: &str) -> String {
    let lower_value = value.to_ascii_lowercase();
    let lower_pattern = pattern.to_ascii_lowercase();
    let Some(index) = lower_value.find(&lower_pattern) else {
        return value.to_string();
    };
    let mut result = value.to_string();
    result.replace_range(index..index + pattern.len(), "");
    result
}

/// Extract artist from "Artist - Title" format common in YouTube titles.
/// Also removes artist prefix from the title when present.
fn clean_artist_for_lyrics(artist: &str, title: &str) -> (String, String) {
    let clean_title_first = clean_title_for_lyrics(title);

    let artist = remove_case_insensitive(artist, " - Topic");
    let artist = artist.trim();
    // Case 1: Title has "Artist - Track" format (extract both)
    if let Some(dash_pos) = clean_title_first.find(" - ") {
        let title_artist = clean_title_first[..dash_pos].trim();
        let title_track = clean_title_first[dash_pos + 3..].trim();

        // If artist param is empty/unknown, use extracted artist
        if artist.trim().is_empty() || artist.trim().eq_ignore_ascii_case("Unknown Artist") {
            return (title_artist.to_string(), title_track.to_string());
        }

        // If artist param matches the title's artist, use title's artist (might have better casing)
        if title_artist.eq_ignore_ascii_case(artist.trim()) {
            return (title_artist.to_string(), title_track.to_string());
        }

        // Otherwise use extracted track name with provided artist
        return (artist.trim().to_string(), clean_title_first);
    }

    // Case 2: Title starts with artist name (e.g. "KR$NA Sensitive")
    let artist_prefix = format!("{} - ", artist.trim());
    let mut result_title = clean_title_first.clone();

    if result_title
        .get(..artist_prefix.len())
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case(&artist_prefix))
    {
        result_title = result_title[artist_prefix.len()..].trim().to_string();
    }

    (artist.trim().to_string(), result_title)
}

/// Fetch lyrics from LRCLIB, then lrc.red when needed, verifying the recording duration.
#[tauri::command]
async fn fetch_lyrics(
    title: String,
    artist: String,
    album: String,
    duration: f64,
) -> Result<LyricResult> {
    lyrics_provider::fetch(title, artist, album, duration).await
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg(not(target_os = "android"))]
struct Archive {
    format: String,
    version: u32,
    tracks: Vec<Track>,
    session: serde_json::Value,
}

#[tauri::command]
#[cfg(not(target_os = "android"))]
async fn export_library(app: AppHandle, session: serde_json::Value) -> Result<bool> {
    work(app, move |_, db| {
        validate_session(&session)?;
        let Some(path) = test_picker("export").unwrap_or_else(|| {
            rfd::FileDialog::new()
                .set_title("Export library metadata — no audio or lyric text")
                .set_file_name("Lumaire-library.json")
                .add_filter("Lumaire library", &["json"])
                .save_file()
        }) else {
            return Ok(false);
        };
        let mut session = session;
        session["lyrics"] = serde_json::json!({});
        session["history"] = serde_json::json!([]);
        let tracks = snapshot(db)?.tracks;
        let archive = Archive {
            format: "lumaire-library".into(),
            version: 1,
            tracks,
            session,
        };
        // Serialize completely before opening the chosen destination.
        let bytes = serde_json::to_vec_pretty(&archive).map_err(err)?;
        fs::write(path, bytes).map_err(err)?;
        Ok(true)
    })
    .await
}
#[tauri::command]
#[cfg(not(target_os = "android"))]
async fn import_library(app: AppHandle) -> Result<Option<Snapshot>> {
    work(app,|_,db|{
        let Some(path)=test_picker("backup").unwrap_or_else(||rfd::FileDialog::new().set_title("Import a Lumaire library backup").add_filter("Lumaire library",&["json"]).pick_file()) else {return Ok(None);};
        let mut archive:Archive=serde_json::from_str(&read_text(&path,10*1024*1024)?).map_err(|_|"This is not a valid Lumaire library backup.".to_string())?;
        if archive.format!="lumaire-library"||archive.version!=1||archive.tracks.len()>10000 {return Err("Unsupported backup version or too many tracks.".into());}
        validate_session(&archive.session)?;
        // Never trust a backup to grant file access. New entries require explicit relinking.
        let existing = snapshot(db)?.session;
        // A metadata-only backup must not erase already attached local texts/history.
        // Ignore text/history in the untrusted archive and retain this device's data.
        archive.session["lyrics"] = existing.as_ref().and_then(|s|s.get("lyrics")).cloned().unwrap_or_else(||serde_json::json!({}));
        archive.session["history"] = existing.as_ref().and_then(|s|s.get("history")).cloned().unwrap_or_else(||serde_json::json!([]));
        let tx=db.transaction().map_err(err)?;
        for mut track in archive.tracks {
            if track.id.len()>100 || track.title.len()>4000 || track.artist.len()>4000 || track.album.len()>4000 || !track.duration.is_finite() || track.duration<0.0 {return Err("Invalid track metadata in backup.".into());}
            track.missing=true;
            track.offline=false;
            tx.execute("INSERT OR IGNORE INTO tracks(id,path,metadata) VALUES(?1,NULL,?2)",params![track.id,serde_json::to_string(&track).map_err(err)?]).map_err(err)?;
        }
        tx.execute("INSERT INTO app_state(id,data) VALUES(1,?1) ON CONFLICT(id) DO UPDATE SET data=excluded.data",[serde_json::to_string(&archive.session).map_err(err)?]).map_err(err)?;
        tx.commit().map_err(err)?;
        Ok(Some(snapshot(db)?))
    }).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[allow(unused_mut)]
    let mut context = tauri::generate_context!();
    #[cfg(debug_assertions)]
    if let Some(root) = std::env::var_os("LUMAIRE_DATA_DIR") {
        for window in &mut context.config_mut().app.windows {
            window.data_directory = Some(PathBuf::from(&root).join("webview"));
        }
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::Builder::new().open_js_links_on_click(false).build())
        .plugin(android::init())
        .setup(|app| {
            #[cfg(windows)]
            app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
            // Tests may isolate data; release builds always use the normal app-private directory.
            let root = if cfg!(debug_assertions) {
                std::env::var_os("LUMAIRE_DATA_DIR")
                    .map(PathBuf::from)
                    .unwrap_or(app.path().app_data_dir()?)
            } else {
                app.path().app_data_dir()?
            };
            fs::create_dir_all(&root)?;
            downloads::cleanup_incomplete(&root.join("downloads"));
            let mut db = Connection::open(root.join("library.sqlite3"))?;
            initialize(&mut db).map_err(std::io::Error::other)?;
            #[cfg(debug_assertions)]
            if let Some(fixtures) = std::env::var_os("LUMAIRE_TEST_FIXTURES") {
                let paths = fs::read_dir(fixtures)?
                    .filter_map(|e| e.ok())
                    .map(|e| e.path())
                    .filter(|p| is_audio(p))
                    .collect();
                import_selected(app.handle(), &mut db, paths).map_err(std::io::Error::other)?;
            }
            #[cfg(windows)]
            if let Some(window) = app.get_webview_window("main") { if let Err(error) = taskbar::install(&window) { log::warn!("Taskbar toolbar: {error}"); } }
            app.manage(Store(Mutex::new(db)));
            app.manage(nearby::Nearby::default());
            #[cfg(target_os = "android")]
            android_background::install(app.handle().clone());
            #[cfg(windows)]
            {
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(error) = offline_repair::repair_existing(handle).await { log::warn!("Offline audio repair: {error}"); }
                });
            }
            #[cfg(windows)]
            app.manage(lyric_overlay::Overlay::default());
            Ok(())
        })
        .on_window_event(|window, event| {
            #[cfg(windows)]
            lyric_overlay::window_event(window, event);
            #[cfg(not(windows))]
            let _ = (window, event);
        })
        .invoke_handler(tauri::generate_handler![
            #[cfg(windows)]
            taskbar::taskbar_publish,
            #[cfg(windows)]
            lyric_overlay::lyric_overlay_publish,
            #[cfg(windows)]
            lyric_overlay::lyric_overlay_control,
            collection_io::read_playlist_file,
            playlist_link::read_playlist_link,
            collection_io::save_catalog_tracks,
            nearby::nearby_start,
            nearby::nearby_stop,
            nearby::nearby_publish,
            nearby::nearby_fetch,
            nearby::nearby_rediscover,
            nearby::nearby_exchange,
            device_sync::get_sync_state,
            device_sync::set_history_sync,
            device_sync::set_favorites_sync,
            device_sync::save_playback_checkpoint,
            device_sync::get_playback_checkpoints,
            device_sync::delete_playback_checkpoint,
            device_sync::get_sync_peer,
            get_verified_source,
            set_verified_source,
            delete_verified_source,
            android::android_background_queue,
            android::android_background_start,
            load_library,
            save_online_track,
            import_audio,
            media_path,
            relink_audio,
            save_session,
            listening::get_listening_history,
            listening::checkpoint_listening,
            listening::clear_listening_history,
            remove_track,
            artwork_cache::cached_artwork,
            audio_analysis::start_audio_analysis,
            audio_analysis::stop_audio_analysis,
            entity_artwork::lookup_entity_artwork,
            downloads::download_track,
            downloads::cancel_download,
            downloads::delete_download,
            downloads::get_download_queue,
            downloads::save_download_queue,
            downloads::update_download_queue_status,
            downloads::clear_download_queue,
            translation::translate_lyrics,
            translation::process_lyrics,
            keyless_translation::process_keyless_lyrics,
            lyric_languages::detect_lyric_languages,
            private_settings::gemini_key_status,
            private_settings::save_gemini_key,
            private_settings::delete_gemini_key,
            pick_lyrics,
            fetch_lyrics,
            lookup_metadata,
            catalog::search_catalog,
            catalog::search_catalog_records,
            catalog::search_mood_collection,
            catalog::search_genre_collection,
            catalog::search_catalog_entities,
            catalog::lookup_catalog,
            catalog::recommend_catalog,
            catalog::lookup_artist,
            catalog::lookup_album,
            catalog::lookup_chart,
            export_library,
            import_library,
            search_commons_audio,
            resolve_commons_audio,
            ytdlp::ytdlp_check_available,
            components::install_youtube_engine,
            components::cancel_youtube_engine_install,
            catalog::discover_albums,
            catalog::discover_page,
            music_metadata::music_metadata,
            apple_charts::apple_chart,
            ytdlp::ytdlp_search,
            ytdlp::ytdlp_get_stream,
            android::android_playback,
            android::android_set_lyrics,
            android::android_set_theme,
            android::android_source,
            android::android_demo_track
        ])
        .build(context)
        .expect("Lumaire could not start")
        .run(|_app, _event| {
            #[cfg(target_os = "android")]
            if let tauri::RunEvent::ExitRequested { api, code: None, .. } = _event {
                if android_background::keep_process_alive() {
                    api.prevent_exit();
                }
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn schema_and_state_survive_reopen() {
        let path = std::env::temp_dir().join(format!("lumaire-{}.db", Uuid::new_v4()));
        {
            let mut db = Connection::open(&path).unwrap();
            initialize(&mut db).unwrap();
            db.execute("INSERT INTO app_state VALUES(1,'{\"queue\":[]}' )", [])
                .unwrap();
        }
        {
            let mut db = Connection::open(&path).unwrap();
            initialize(&mut db).unwrap();
            assert!(snapshot(&db).unwrap().session.is_some());
        }
        let _ = fs::remove_file(path);
    }
    #[test]
    fn future_schema_is_preserved() {
        let mut db = Connection::open_in_memory().unwrap();
        db.execute_batch("PRAGMA user_version=100").unwrap();
        assert!(initialize(&mut db).is_err());
        assert_eq!(
            db.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            100
        );
    }
    #[test]
    fn invalid_session_is_rejected() {
        assert!(validate_session(&serde_json::json!({"queue":[]})).is_err());
    }

    #[test]
    fn commons_audio_mime_and_license_codes_are_validated() {
        let audio = serde_json::json!({"mime":"application/ogg","mediatype":"AUDIO"});
        assert_eq!(commons_mime(&audio), "audio/ogg");
        assert!(licensed_audio(&commons_mime(&audio), "cc-by-sa-4.0"));
        assert!(licensed_audio("audio/wav", "cc-zero"));
        assert!(!licensed_audio("audio/wav", "all-rights-reserved"));
        assert!(!licensed_audio(
            &commons_mime(&serde_json::json!({"mime":"application/ogg","mediatype":"VIDEO"})),
            "cc-by-sa-4.0"
        ));
    }

    #[test]
    fn removing_linked_music_cleans_all_references_and_preserves_the_external_file() {
        let folder = std::env::temp_dir().join(format!("lumaire-remove-{}", Uuid::new_v4()));
        fs::create_dir(&folder).unwrap();
        let audio = folder.join("external.wav");
        fs::write(&audio, b"external file remains").unwrap();
        let database = folder.join("library.db");
        let mut db = Connection::open(&database).unwrap();
        initialize(&mut db).unwrap();
        let track = inspect(&audio, "local".into());
        db.execute(
            "INSERT INTO tracks(id,path,metadata) VALUES(?1,?2,?3)",
            params![
                track.id,
                audio.to_string_lossy(),
                serde_json::to_string(&track).unwrap()
            ],
        )
        .unwrap();
        let session = serde_json::json!({"queue":[{"id":"one","trackId":"local"},{"id":"two","trackId":"local"}],"currentId":"one","position":9,"favorites":["local"],"playlists":[{"id":"keep","name":"Keep","items":[{"id":"three","trackId":"local"}]}],"history":[{"trackId":"local","at":"today"}],"lyrics":{"local":{"raw":"text"}},"settings":{}});
        let result = remove_track_data(&mut db, "local", session).unwrap();
        assert!(result.tracks.is_empty());
        let session = result.session.unwrap();
        assert!(session["queue"].as_array().unwrap().is_empty());
        assert_eq!(session["currentId"], serde_json::Value::Null);
        assert_eq!(session["position"], 0);
        assert!(session["favorites"].as_array().unwrap().is_empty());
        assert!(session["history"].as_array().unwrap().is_empty());
        assert!(session["lyrics"].as_object().unwrap().is_empty());
        assert_eq!(session["playlists"][0]["name"], "Keep");
        assert!(session["playlists"][0]["items"]
            .as_array()
            .unwrap()
            .is_empty());
        drop(db);
        let db = Connection::open(&database).unwrap();
        assert!(snapshot(&db).unwrap().tracks.is_empty());
        drop(db);
        assert!(audio.exists());
        fs::remove_dir_all(folder).unwrap();
    }

    #[test]
    fn offline_source_identity_and_file_path_survive_reopen_and_metadata_updates() {
        let folder = std::env::temp_dir().join(format!("lumaire-offline-{}", Uuid::new_v4()));
        fs::create_dir(&folder).unwrap();
        let audio = folder.join("managed.wav");
        fs::write(&audio, b"fixture audio").unwrap();
        let database = folder.join("library.db");
        let mut db = Connection::open(&database).unwrap();
        initialize(&mut db).unwrap();
        let mut track: Track = serde_json::from_value(serde_json::json!({"id":"wikimedia-commons:42","title":"Open audio","artist":"Author","album":"Commons","duration":1,"fileName":"open.wav","format":"WAV","missing":false,"source":{"providerId":"wikimedia-commons","sourceId":"42","pageUrl":"untrusted","license":"CC0","licenseUrl":"https://creativecommons.org/publicdomain/zero/1.0/","attribution":"Author"}})).unwrap();
        save_remote(&db, track.clone()).unwrap();
        track.offline = true;
        db.execute(
            "UPDATE tracks SET path=?1,metadata=?2",
            params![
                audio.to_string_lossy(),
                serde_json::to_string(&track).unwrap()
            ],
        )
        .unwrap();
        let updated = save_remote(&db, track).unwrap();
        assert!(updated.offline);
        drop(db);
        let db = Connection::open(&database).unwrap();
        let saved = snapshot(&db).unwrap();
        assert_eq!(saved.tracks.len(), 1);
        assert!(saved.tracks[0].offline);
        assert!(!saved.tracks[0].missing);
        assert!(saved.tracks[0].source.is_some());
        drop(db);
        fs::remove_dir_all(folder).unwrap();
    }

    #[test]
    #[ignore = "explicit live metadata check; requires network"]
    fn live_musicbrainz_snowman_lookup() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let metadata = runtime
            .block_on(lookup_musicbrainz("Snowman".into(), "Sia".into(), 173.0))
            .unwrap();
        assert!(metadata.is_some(), "No verified recording returned");
    }

    #[test]
    #[ignore = "explicit regional metadata check; requires network"]
    fn live_regional_metadata_without_an_artist() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        runtime.block_on(async {
            for (title, duration) in [("Karuppa Kooda Va", 258.0), ("Radhimaa", 260.0)] {
                let metadata = lookup_metadata(title.into(), "Unknown artist".into(), duration)
                    .await
                    .unwrap()
                    .expect("Regional track was not recognized");
                assert!(metadata.artist.contains("Sai Abhyankkar"));
                assert!(metadata
                    .source_id
                    .as_deref()
                    .unwrap()
                    .starts_with("itunes:"));
                assert!(!metadata.album.is_empty());
                assert!(lyric_identity::title(&metadata.title) == lyric_identity::title(title));
            }
            let metadata = lookup_metadata("Aarzu".into(), "Noor, Khan, Madhurxo".into(), 226.0)
                .await
                .unwrap()
                .expect("Hindi collaboration was not recognized");
            assert!(lyric_identity::artists_match(&metadata.artist, "Noor"));
        });
    }

    #[test]
    fn metadata_matches_collaboration_and_preserves_release_artwork() {
        let recording: MusicBrainzRecording = serde_json::from_value(serde_json::json!({
            "id":"recording-id", "title":"கூட - From \"படம்\"", "score":100, "length":188000,
            "artist-credit":[{"name":"Noor"},{"name":"Khan"}],
            "releases":[{"id":"76df3287-6cda-33eb-8e9a-044b5e15ffdd","title":"Album"}]
        }))
        .unwrap();
        assert!(metadata_candidate_matches(
            &recording,
            "கூட",
            "Noor, Khan, Madhurxo",
            188.0
        ));
        assert!(!metadata_candidate_matches(
            &recording,
            "கூட",
            "Unrelated artist",
            188.0
        ));
        assert!(!metadata_candidate_matches(
            &recording,
            "கூட (Live)",
            "Noor",
            188.0
        ));
        assert!(!metadata_candidate_matches(&recording, "கட", "Noor", 188.0));
        assert!(!metadata_candidate_matches(
            &recording,
            "கூட",
            "Noor",
            226.0
        ));
        let value = serde_json::to_value(canonical_metadata(&recording, "fallback")).unwrap();
        assert_eq!(value["artist"], "Noor, Khan");
        assert_eq!(
            value["artworkUrl"],
            "https://coverartarchive.org/release/76df3287-6cda-33eb-8e9a-044b5e15ffdd/front-500"
        );
        assert_eq!(value["sourceId"], "recording-id");
    }

    #[test]
    fn online_tracks_survive_reopen_and_duplicate_saves_without_missing_file_flags() {
        let path = std::env::temp_dir().join(format!("lumaire-remote-{}.db", Uuid::new_v4()));
        let track: Track = serde_json::from_value(serde_json::json!({
            "id":"youtube:abcdefghijk", "title":"Snowman", "artist":"Sia", "album":"", "duration":173,
            "fileName":"Snowman", "missing":false, "format":"YouTube",
            "artworkUrl":"https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg", "metadataSourceId":"itunes:123",
            "source":{"providerId":"youtube", "sourceId":"abcdefghijk", "pageUrl":"untrusted",
                "license":"YouTube", "licenseUrl":"https://www.youtube.com/t/terms", "attribution":"Sia"}
        })).unwrap();
        {
            let mut db = Connection::open(&path).unwrap();
            initialize(&mut db).unwrap();
            save_remote(&db, track.clone()).unwrap();
            save_remote(&db, track.clone()).unwrap();
        }
        {
            let db = Connection::open(&path).unwrap();
            let saved = snapshot(&db).unwrap().tracks;
            assert_eq!(saved.len(), 1);
            assert!(!saved[0].missing);
            assert_eq!(saved[0].artwork_url, track.artwork_url);
            assert_eq!(saved[0].metadata_source_id, track.metadata_source_id);
            let mut bad_catalog = track.clone();
            bad_catalog.metadata_source_id = Some("itunes:0".into());
            assert!(save_remote(&db, bad_catalog).is_err());
            let mut saavn = track.clone();
            saavn.metadata_source_id = Some("saavn:QAbmbZ7O".into());
            assert_eq!(save_remote(&db, saavn).unwrap().metadata_source_id.as_deref(), Some("saavn:QAbmbZ7O"));
            let mut brainz = track.clone();
            brainz.metadata_source_id = Some("musicbrainz:recording:c4197d72-b3dd-445f-bdb8-a7f6598b5f74".into());
            assert_eq!(save_remote(&db, brainz).unwrap().metadata_source_id.as_deref(), Some("musicbrainz:recording:c4197d72-b3dd-445f-bdb8-a7f6598b5f74"));
            let mut invalid_saavn = track.clone();
            invalid_saavn.metadata_source_id = Some("saavn:bad/path".into());
            assert!(save_remote(&db, invalid_saavn).is_err());
            assert_eq!(
                saved[0].source.as_ref().unwrap().page_url,
                "https://www.youtube.com/watch?v=abcdefghijk"
            );
            let local_path: Option<String> = db
                .query_row("SELECT path FROM tracks", [], |r| r.get(0))
                .unwrap();
            assert!(local_path.is_none());
            let mut invalid = track.clone();
            invalid.id = "someone-elses-local-track".into();
            assert!(save_remote(&db, invalid).is_err());
            db.execute("UPDATE tracks SET path='local-file-reference'", [])
                .unwrap();
            let mut conflicting = track.clone();
            conflicting.title = "Must not overwrite local identity".into();
            assert!(save_remote(&db, conflicting).is_err());
            assert_eq!(snapshot(&db).unwrap().tracks[0].title, "Snowman");
        }
        let _ = fs::remove_file(path);
    }

    #[test]
    fn cleans_youtube_title_labels_and_channel_segments() {
        assert_eq!(
            clean_artist_for_lyrics(
                "KR$NA",
                "KR$NA - Sensitive Ft. Seedhe Maut | Samay Raina | Prod. Hurricane | Official Music Video from YouTube"
            ),
            ("KR$NA".to_string(), "Sensitive".to_string())
        );
    }

    #[test]
    fn cleans_video_labels_without_an_artist_prefix() {
        assert_eq!(
            clean_title_for_lyrics("Sensitive [Official Music Video] from YouTube"),
            "Sensitive"
        );
        assert_eq!(
            clean_title_for_lyrics("Sensitive | KR$NA - Topic | Official Audio"),
            "Sensitive"
        );
    }

    #[test]
    fn extracts_artist_from_separator_title() {
        assert_eq!(
            clean_artist_for_lyrics("unknown artist", "KR$NA - Sensitive (Official Video)"),
            ("KR$NA".to_string(), "Sensitive".to_string())
        );
    }

    #[test]
    fn verified_source_upsert_and_delete_preserve_user_choice() {
        let mut db = Connection::open_in_memory().unwrap();
        initialize(&mut db).unwrap();
        let source = VerifiedSource {
            user_selected: true,
            source_id: "abcdefghijk".into(),
            source_provider: "youtube".into(),
            title: "Song".into(),
            artist: Some("Artist".into()),
            duration: Some(180.0),
        };
        db.execute("INSERT INTO verified_sources(catalog_id,source_id,source_provider,title,artist,duration,verified_at,user_selected) VALUES(?1,?2,?3,?4,?5,?6,unixepoch(),?7)", params!["catalog:1", source.source_id, source.source_provider, source.title, source.artist, source.duration, source.user_selected]).unwrap();
        let selected: bool = db.query_row("SELECT user_selected FROM verified_sources WHERE catalog_id='catalog:1'", [], |row| row.get(0)).unwrap();
        assert!(selected);
        db.execute("DELETE FROM verified_sources WHERE catalog_id='catalog:1'", []).unwrap();
        let exists: bool = db.query_row("SELECT EXISTS(SELECT 1 FROM verified_sources WHERE catalog_id='catalog:1')", [], |row| row.get(0)).unwrap();
        assert!(!exists);
    }
}
