//! Android-only platform boundary. Desktop keeps its existing adapters.
/// Generates an original test tone inside this app only. No arbitrary paths,
/// external media, or credentials. Disabled in release builds.
#[tauri::command]
pub async fn android_demo_track(app: tauri::AppHandle) -> crate::Result<crate::Imported> {
    #[cfg(all(debug_assertions, target_os = "android"))]
    {
        use tauri::Manager;
        crate::work(app, |app, db| {
            let folder = app
                .path()
                .app_data_dir()
                .map_err(crate::err)?
                .join("test-fixtures");
            std::fs::create_dir_all(&folder).map_err(crate::err)?;
            let path = folder.join("Lumaire - Android prototype.wav");
            if !path.exists() {
                const RATE: u32 = 8000;
                const COUNT: u32 = RATE * 40;
                let mut wav = Vec::with_capacity(44 + COUNT as usize * 2);
                wav.extend(b"RIFF");
                wav.extend((36 + COUNT * 2).to_le_bytes());
                wav.extend(b"WAVEfmt ");
                wav.extend(16u32.to_le_bytes());
                wav.extend(1u16.to_le_bytes());
                wav.extend(1u16.to_le_bytes());
                wav.extend(RATE.to_le_bytes());
                wav.extend((RATE * 2).to_le_bytes());
                wav.extend(2u16.to_le_bytes());
                wav.extend(16u16.to_le_bytes());
                wav.extend(b"data");
                wav.extend((COUNT * 2).to_le_bytes());
                for sample in 0..COUNT {
                    let value = ((sample as f64 * 330.0 * std::f64::consts::TAU / RATE as f64)
                        .sin()
                        * 1000.0) as i16;
                    wav.extend(value.to_le_bytes());
                }
                std::fs::write(&path, wav).map_err(crate::err)?;
            }
            crate::import_selected(app, db, vec![path])
        })
        .await
    }
    #[cfg(not(all(debug_assertions, target_os = "android")))]
    {
        let _ = app;
        Err("Synthetic device fixture is available only in Android debug builds.".into())
    }
}
use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("lumaire-android")
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            {
                use tauri::Manager;
                let handle = _api.register_android_plugin("app.lumaire.player", "LumairePlugin")?;
                _app.manage(Android(handle));
            }
            Ok(())
        })
        .build()
}

#[cfg(target_os = "android")]
pub struct Android<R: Runtime>(tauri::plugin::PluginHandle<R>);

#[cfg(target_os = "android")]
static LOAD_GENERATION: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

#[cfg(target_os = "android")]
pub async fn call(
    app: &tauri::AppHandle,
    command: &str,
    args: serde_json::Value,
) -> crate::Result<serde_json::Value> {
    use tauri::Manager;
    app.state::<Android<tauri::Wry>>()
        .0
        .run_mobile_plugin_async(command, args)
        .await
        .map_err(|e| e.to_string())
}

#[derive(serde::Deserialize)]
#[cfg_attr(not(any(target_os = "android", test)), allow(dead_code))]
pub struct DisplayMetadata {
    title: String,
    artist: String,
    #[serde(default)]
    pub artwork_url: Option<String>,
}

#[cfg(any(target_os = "android", test))]
fn validate_display_metadata(metadata: &DisplayMetadata) -> crate::Result<()> {
    if metadata.title.trim().is_empty()
        || metadata.title.chars().count() > 4000
        || metadata.artist.chars().count() > 4000
        || metadata.artwork_url.as_ref().is_some_and(|u| u.chars().count() > 4000)
    {
        return Err("Invalid playback display metadata.".into());
    }
    Ok(())
}

#[tauri::command]
#[cfg_attr(not(target_os = "android"), allow(dead_code))]
pub async fn android_background_queue(_app: tauri::AppHandle, queue: serde_json::Value, revision: u64) -> crate::Result<serde_json::Value> {
    #[cfg(target_os = "android")]
    {
        let queue = prepare_background_queue(_app.clone(), queue, None).await?;
        call(&_app, "backgroundQueue", serde_json::json!({"queue":queue,"revision":revision})).await
    }
    #[cfg(not(target_os = "android"))]
    { let _ = (_app, queue, revision); Err("Background queue is available only on Android.".into()) }
}

#[cfg(target_os = "android")]
async fn prepare_background_queue(app: tauri::AppHandle, mut queue: serde_json::Value, generation: Option<u64>) -> crate::Result<serde_json::Value> {
    crate::validate_session(&queue["session"])?;
    if queue.to_string().len() > 20 * 1024 * 1024 { return Err("Background queue is too large.".into()); }
    let session = &queue["session"];
    let entries = session["queue"].as_array().ok_or("Invalid queue.")?;
    let mut seen = std::collections::HashSet::new();
    for entry in entries {
        let id = entry["id"].as_str().filter(|s| !s.is_empty() && s.len() <= 256).ok_or("Invalid queue occurrence.")?;
        if !seen.insert(id) || entry["trackId"].as_str().is_none_or(|s| s.is_empty() || s.len() > 512) { return Err("Invalid queue identity.".into()); }
    }
    if !entries.iter().any(|entry| entry["id"] == session["currentId"]) { return Err("Choose a queued song first.".into()); }
    let _: std::collections::HashMap<String, crate::Track> = serde_json::from_value(session["queueTracks"].clone()).map_err(crate::err)?;
    let _: Vec<String> = serde_json::from_value(session["shuffleOrder"].clone()).map_err(crate::err)?;
    if !matches!(session["settings"]["repeat"].as_str(), Some("off" | "one" | "all"))
        || !session["settings"]["shuffle"].is_boolean() || !session["settings"]["autoplay"].is_boolean() { return Err("Invalid queue settings.".into()); }
    if queue["languages"].as_array().is_none_or(|a| a.len() > 32 || a.iter().any(|v| v.as_str().is_none_or(|s| s.len() > 64))) { return Err("Invalid music preferences.".into()); }
    let session = queue["session"].clone();
    let (snapshot, history) = crate::work(app, move |_, db| {
        if generation.is_some_and(|owner| LOAD_GENERATION.load(std::sync::atomic::Ordering::SeqCst) != owner) { return Err("Playback selection changed.".into()); }
        let session = if generation.is_some() { session } else { crate::android_background::merge_session(session) };
        crate::write_session(db, &session)?;
        Ok((crate::snapshot(db)?, crate::listening::read(db)?))
    }).await?;
    queue["tracks"] = serde_json::to_value(snapshot.tracks).map_err(crate::err)?;
    queue["records"] = serde_json::to_value(history.records).map_err(crate::err)?;
    queue["listeningGeneration"] = history.generation.into();
    if queue["listening"]["generation"].as_i64() != Some(history.generation) {
        queue["listening"]["record"] = serde_json::Value::Null;
        queue["listening"]["generation"] = history.generation.into();
    }
    // Documents stay in SQLite; the native worker needs only queue and recommendation context.
    queue["session"]["lyrics"] = serde_json::json!({});
    queue["session"]["playlists"] = serde_json::json!([]);
    queue["session"].as_object_mut().unwrap().remove("replica");
    Ok(queue)
}

#[tauri::command]
#[cfg_attr(not(target_os = "android"), allow(dead_code))]
pub async fn android_background_start(_app: tauri::AppHandle, queue: serde_json::Value, autoplay: bool, position: f64) -> crate::Result<serde_json::Value> {
    #[cfg(target_os = "android")]
    {
        use std::sync::atomic::Ordering;
        if !position.is_finite() || position < 0.0 { return Err("Invalid playback position.".into()); }
        let generation = LOAD_GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
        call(&_app, "invalidateQueue", serde_json::json!({})).await?;
        if LOAD_GENERATION.load(Ordering::SeqCst) != generation { return Err("Playback selection changed.".into()); }
        call(&_app, "cancelResolution", serde_json::json!({})).await?;
        let queue = prepare_background_queue(_app.clone(), queue, Some(generation)).await?;
        if LOAD_GENERATION.load(Ordering::SeqCst) != generation { return Err("Playback selection changed.".into()); }
        call(&_app, "startBackgroundQueue", serde_json::json!({"queue":queue,"autoplay":autoplay,"position":position})).await
    }
    #[cfg(not(target_os = "android"))]
    { let _ = (_app, queue, autoplay, position); Err("Background queue is available only on Android.".into()) }
}

#[tauri::command]
pub async fn android_playback(
    _app: tauri::AppHandle,
    action: String,
    id: Option<String>,
    position: Option<f64>,
    autoplay: Option<bool>,
    value: Option<f64>,
    display_metadata: Option<DisplayMetadata>,
) -> crate::Result<serde_json::Value> {
    #[cfg(target_os = "android")]
    {
        use crate::*;
        let mut args = serde_json::json!({"action":action});
        match action.as_str() {
            "load" => {
                call(&_app, "invalidateQueue", serde_json::json!({})).await?;
                use std::sync::atomic::Ordering;
                if let Some(metadata) = display_metadata.as_ref() {
                    validate_display_metadata(metadata)?;
                }
                let generation = LOAD_GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
                call(&_app, "cancelResolution", serde_json::json!({})).await?;
                let id = id.ok_or("Choose a track first.")?;
                let saved = work(_app.clone(), {
                    let id = id.clone();
                    move |_, db| {
                        db.query_row("SELECT metadata,path FROM tracks WHERE id=?1", [id], |r| {
                            Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?))
                        })
                        .optional()
                        .map_err(err)
                    }
                })
                .await?;
                let track = saved
                    .as_ref()
                    .map(|(json, _)| serde_json::from_str::<Track>(json))
                    .transpose()
                    .map_err(err)?;
                if LOAD_GENERATION.load(Ordering::SeqCst) != generation {
                    return Err("Playback selection changed.".into());
                }
                let mut online = serde_json::Value::Null;
                let uri = if saved.as_ref().is_some_and(|(_, path)| path.is_some()) {
                    let path = crate::media_path_inner(_app.clone(), id.clone()).await?;
                    reqwest::Url::from_file_path(path)
                        .map_err(|_| "Invalid local audio path.")?
                        .to_string()
                } else if let Some(source) = id.strip_prefix("wikimedia-commons:") {
                    crate::resolve_commons_audio_inner(source.to_string()).await?.url
                } else if let Some(video) = id.strip_prefix("youtube:") {
                    validate_video_id(video)?;
                    online = call(
                        &_app,
                        "resolveSource",
                        serde_json::json!({"operation":"resolve", "videoId":video}),
                    )
                    .await?;
                    crate::ytdlp::validate_audio_codecs(online["codec"].as_str(), online["videoCodec"].as_str())?;
                    args["headers"] = online["headers"].clone();
                    online["url"]
                        .as_str()
                        .ok_or("The source returned no playable audio.")?
                        .to_string()
                } else {
                    return Err("Choose an imported file or a supported online source.".into());
                };
                args["uri"] = uri.into();
                if LOAD_GENERATION.load(Ordering::SeqCst) != generation {
                    return Err("Playback selection changed.".into());
                }
                args["id"] = id.into();
                args["title"] = track
                    .as_ref()
                    .map(|t| t.title.clone())
                    .unwrap_or_else(|| {
                        online["title"]
                            .as_str()
                            .unwrap_or("Online audio")
                            .to_string()
                    })
                    .into();
                args["artist"] = track
                    .as_ref()
                    .map(|t| t.artist.clone())
                    .unwrap_or_default()
                    .into();
                let artwork = display_metadata
                    .as_ref()
                    .and_then(|m| m.artwork_url.clone())
                    .or_else(|| track.as_ref().and_then(|t| t.artwork_url.clone()));
                if let Some(art) = artwork {
                    args["artwork"] = art.into();
                }
                if let Some(metadata) = display_metadata {
                    args["title"] = metadata.title.into();
                    args["artist"] = metadata.artist.into();
                }
                args["position"] = position
                    .filter(|v| v.is_finite() && *v >= 0.0)
                    .unwrap_or(0.0)
                    .into();
                args["autoplay"] = autoplay.unwrap_or(false).into();
            }
            "seek" | "volume" => {
                args["value"] = value
                    .filter(|v| v.is_finite() && *v >= 0.0)
                    .ok_or("Invalid playback value.")?
                    .into();
            }
            "stop" => {
                call(&_app, "invalidateQueue", serde_json::json!({})).await?;
                LOAD_GENERATION.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                call(&_app, "cancelResolution", serde_json::json!({})).await?;
            }
            "cancel" => {
                LOAD_GENERATION.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                call(&_app, "cancelResolution", serde_json::json!({})).await?;
                args["action"] = "state".into();
            }
            "play" | "pause" | "state" => {}
            _ => return Err("Unsupported playback action.".into()),
        }
        call(&_app, "playback", args).await
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (action, id, position, autoplay, value, display_metadata);
        Err("Android playback is available only in the Android app.".into())
    }
}

#[derive(serde::Deserialize, serde::Serialize)]
pub struct WidgetLyricLine {
    pub time: Option<i64>,
    pub text: String,
}

#[tauri::command]
pub async fn android_set_lyrics(
    _app: tauri::AppHandle,
    track_id: String,
    lines: Vec<WidgetLyricLine>,
) -> crate::Result<()> {
    #[cfg(target_os = "android")]
    {
        call(
            &_app,
            "setLyrics",
            serde_json::json!({
                "trackId": track_id,
                "lines": lines,
            }),
        )
        .await?;
        Ok(())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (track_id, lines);
        Ok(())
    }
}

#[tauri::command]
pub async fn android_set_theme(
    _app: tauri::AppHandle,
    theme_mode: String,
    accent_color: String,
) -> crate::Result<()> {
    #[cfg(target_os = "android")]
    {
        call(
            &_app,
            "setTheme",
            serde_json::json!({
                "themeMode": theme_mode,
                "accentColor": accent_color,
            }),
        )
        .await?;
        Ok(())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (theme_mode, accent_color);
        Ok(())
    }
}

#[cfg_attr(not(target_os = "android"), allow(dead_code))]
pub(crate) fn validate_video_id(video: &str) -> crate::Result<()> {
    if video.len() == 11
        && video
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
    {
        Ok(())
    } else {
        Err("Invalid YouTube video ID.".into())
    }
}

/// Android-only resolver facade. The Windows yt-dlp commands remain unchanged.
#[tauri::command]
pub async fn android_source(
    _app: tauri::AppHandle,
    operation: String,
    video_id: Option<String>,
    query: Option<String>,
    max_results: Option<u32>,
    client: Option<String>,
) -> crate::Result<serde_json::Value> {
    #[cfg(target_os = "android")]
    {
        let mut request = serde_json::json!({"operation":operation});
        match operation.as_str() {
            "probe" => {}
            "debugMediaRefusal" => {
                if !cfg!(debug_assertions) { return Err("Test transport is unavailable.".into()); }
                return call(&_app, "debugMediaRefusal", serde_json::json!({})).await;
            }
            "resolve" | "challenge" => {
                let video = video_id.ok_or("Choose a video first.")?;
                validate_video_id(&video)?;
                request["videoId"] = video.into();
                if operation == "challenge" {
                    if !cfg!(debug_assertions) {
                        return Err("Diagnostics require a debug build.".into());
                    }
                    let client = client.unwrap_or_else(|| "web_safari".into());
                    if !["web", "web_safari", "web_embedded", "tv"].contains(&client.as_str()) {
                        return Err("Unsupported diagnostic client.".into());
                    }
                    request["client"] = client.into();
                }
            }
            "search" => {
                let query = query.unwrap_or_default().trim().to_string();
                if query.is_empty() || query.chars().count() > 200 {
                    return Err("Enter a search of 1–200 characters.".into());
                }
                request["query"] = query.into();
                request["maxResults"] = max_results.unwrap_or(10).clamp(1, 10).into();
            }
            "diagnostics" => {
                return call(&_app, "resolverDiagnostics", serde_json::json!({})).await
            }
            _ => return Err("Unsupported Android source operation.".into()),
        }
        let response = call(&_app, "resolveSource", request).await?;
        if operation == "resolve" {
            crate::ytdlp::validate_audio_codecs(response["codec"].as_str(), response["videoCodec"].as_str())?;
        }
        Ok(response)
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (operation, video_id, query, max_results, client);
        Err("Android source resolution is available only in the Android app.".into())
    }
}

#[cfg(test)]
mod tests {
    use super::{validate_display_metadata, validate_video_id, DisplayMetadata};
    #[test]
    fn transient_display_metadata_validates_names_without_source_fields() {
        let valid: DisplayMetadata = serde_json::from_value(serde_json::json!({
            "title":"கூட", "artist":"பாடகர்"
        }))
        .unwrap();
        assert!(validate_display_metadata(&valid).is_ok());
        assert!(validate_display_metadata(&DisplayMetadata {
            title: "Song".into(),
            artist: String::new(),
            artwork_url: None,
        })
        .is_ok());
        for (title, artist) in [
            (" \n".to_string(), "Artist".to_string()),
            ("அ".repeat(4001), "Artist".to_string()),
            ("Song".to_string(), "A".repeat(4001)),
        ] {
            assert!(validate_display_metadata(&DisplayMetadata {
                title,
                artist,
                artwork_url: None,
            })
            .is_err());
        }
    }
    #[test]
    fn source_identity_rejects_urls_arguments_and_paths() {
        for input in [
            "https://youtube.com/watch?v=aqz-KE-bpKQ",
            "../config",
            "--cookies=x",
            "aqz-KE-bpKQ\n",
            "１２３４５６７８９０１",
        ] {
            assert!(validate_video_id(input).is_err());
        }
        assert!(validate_video_id("aqz-KE-bpKQ").is_ok());
    }
}
