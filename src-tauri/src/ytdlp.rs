use log::{debug, error};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::io::Read;
use std::time::{Duration, Instant};

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct YtdlpSearchResult {
    pub id: String,
    pub title: String,
    pub duration: Option<f64>,
    pub thumbnail: Option<String>,
    pub channel: Option<String>,
    pub track: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct YtdlpStreamInfo {
    pub stream_url: String,
    pub duration: Option<f64>,
    pub title: Option<String>,
    pub container: Option<String>,
    pub codec: Option<String>,
    pub video_codec: Option<String>,
    pub track: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
}

#[derive(Deserialize)]
struct YtdlpJson {
    id: Option<String>,
    title: Option<String>,
    duration: Option<f64>,
    url: Option<String>,
    thumbnail: Option<String>,
    ext: Option<String>,
    acodec: Option<String>,
    vcodec: Option<String>,
    channel: Option<String>,
    track: Option<String>,
    artist: Option<String>,
    artists: Option<Vec<String>>,
    album: Option<String>,
}

fn find_ytdlp() -> Result<PathBuf, String> {
    if let Some(path) = crate::components::managed_engine() {
        return Ok(path);
    }
    // Try current directory first (for bundled binary)
    let local_path = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|p| p.join("yt-dlp.exe")));

    if let Some(path) = local_path {
        if path.exists() {
            debug!("[yt-dlp] Found bundled binary at {:?}", path);
            return Ok(path);
        }
    }

    // Try system PATH
    #[cfg(target_os = "windows")]
    {
        if let Some(paths) = std::env::var_os("PATH") {
            for folder in std::env::split_paths(&paths) {
                let path = folder.join("yt-dlp.exe");
                if path.is_file() {
                    debug!("[yt-dlp] Found system binary at {:?}", path);
                    return Ok(path);
                }
            }
        }
    }

    Err("YouTube engine is not installed. Open Settings > Online Sources and choose Install engine.".to_string())
}

pub(crate) fn run_ytdlp(args: &[&str]) -> Result<String, String> {
    let program = find_ytdlp()?;

    let mut cmd = Command::new(&program);
    if let Some(runtime) = crate::components::managed_runtime(&program) {
        cmd.arg("--js-runtimes")
            .arg(format!("quickjs:{}", runtime.display()));
    }
    cmd.args(args).stdout(Stdio::piped()).stderr(Stdio::piped());

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    debug!("[yt-dlp] Executing: {:?} {:?}", program, args);

    let mut child = cmd.spawn().map_err(|error| {
        error!("[yt-dlp] Failed to execute: {}", error);
        format!("Failed to execute yt-dlp: {}. Is yt-dlp installed?", error)
    })?;

    let mut stdout = child.stdout.take().ok_or("The audio engine did not provide an output pipe.")?;
    let mut stderr = child.stderr.take().ok_or("The audio engine did not provide an error pipe.")?;
    let output_reader = std::thread::spawn(move || { let mut bytes = Vec::new(); stdout.by_ref().take(8_000_001).read_to_end(&mut bytes).map(|_| bytes) });
    let error_reader = std::thread::spawn(move || { let mut bytes = Vec::new(); stderr.by_ref().take(65_537).read_to_end(&mut bytes).map(|_| bytes) });
    let started = Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait().map_err(|error| error.to_string())? { break status; }
        if started.elapsed() >= Duration::from_secs(45) {
            let _ = child.kill();
            let _ = child.wait();
            return Err("The audio source engine timed out. Retry later or choose another recording.".into());
        }
        std::thread::sleep(Duration::from_millis(50));
    };
    let stdout = output_reader.join().map_err(|_| "Audio engine output reader failed.")?.map_err(|error| error.to_string())?;
    let stderr = error_reader.join().map_err(|_| "Audio engine error reader failed.")?.map_err(|error| error.to_string())?;
    if stdout.len() > 8_000_000 || stderr.len() > 65_536 { return Err("Audio engine output exceeded its size limit. Use a smaller playlist or retry later.".into()); }
    if !status.success() {
        let stderr = String::from_utf8_lossy(&stderr);
        error!("[yt-dlp] Command failed: {}", stderr);
        return Err(format!(
            "yt-dlp error: {}",
            stderr.lines().take(3).collect::<Vec<_>>().join(" ")
        ));
    }

    Ok(String::from_utf8_lossy(&stdout).into_owned())
}

fn run_ytdlp_with_client(args: &[&str], client: &str) -> Result<String, String> {
    let mut owned = args
        .iter()
        .map(|arg| (*arg).to_string())
        .collect::<Vec<_>>();
    owned.push("--extractor-args".to_string());
    owned.push(format!("youtube:player_client={client}"));
    let refs = owned.iter().map(String::as_str).collect::<Vec<_>>();
    run_ytdlp(&refs)
}

fn is_youtube_verification_error(error: &str) -> bool {
    let lower = error.to_ascii_lowercase();
    lower.contains("sign in to confirm")
        || lower.contains("not a bot")
        || lower.contains("confirm you're not a bot")
}

fn friendly_stream_error(error: String) -> String {
    if is_youtube_verification_error(&error) {
        return "YouTube asked for verification and did not provide a playable stream. Try another upload or retry later.".into();
    }
    error
}

fn parse_ndjson_entries(stdout: &str) -> Vec<YtdlpJson> {
    stdout
        .lines()
        .filter(|line| !line.trim().is_empty())
        .filter_map(|line| {
            serde_json::from_str::<YtdlpJson>(line)
                .map_err(|e| {
                    debug!("[yt-dlp] Failed to parse line: {}", e);
                    e
                })
                .ok()
        })
        .collect()
}

/// Heuristic filter to identify likely music content vs random YouTube videos.
/// Helps avoid tutorials, podcasts, vlogs, gameplay, etc. being classified as songs.
fn is_likely_music(result: &YtdlpSearchResult) -> bool {
    let title = result.title.to_lowercase();
    let channel = result.channel.as_deref().unwrap_or_default().to_lowercase();
    let words: Vec<_> = title
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
        .collect();
    let excluded = [
        "podcast",
        "interview",
        "tutorial",
        "review",
        "unboxing",
        "vlog",
        "gameplay",
        "walkthrough",
        "reaction",
        "explained",
        "documentary",
        "news",
        "trailer",
        "lecture",
        "lesson",
        "course",
        "episode",
    ];
    if excluded.iter().any(|w| words.contains(w)) || title.contains("how to ") {
        return false;
    }
    if result
        .duration
        .is_some_and(|d| !d.is_finite() || !(30.0..=1200.0).contains(&d))
    {
        return false;
    }
    // Generic channel words (official/music) and substrings (ep/visual) aren't
    // evidence of a song. Positive evidence is required, including when duration
    // is absent. Unknown content is omitted, never silently promoted to music.
    if result
        .track
        .as_ref()
        .is_some_and(|track| !track.trim().is_empty())
        && result
            .artist
            .as_ref()
            .is_some_and(|artist| !artist.trim().is_empty())
    {
        return true;
    }
    [
        "official audio",
        "official music video",
        "lyric video",
        "official lyric",
        "visualizer",
    ]
    .iter()
    .any(|label| title.contains(label))
        || words.contains(&"lyrics")
        || words.contains(&"lyrical")
        || ((title.contains("(prod ") || title.contains("(prod.") || title.contains("(produced by"))
            && title.contains('-'))
        || channel.ends_with(" - topic")
        || channel.ends_with("vevo")
        || (title.contains(" - ")
            && (title.contains("official video") || channel.ends_with(" records")))
}

#[tauri::command]
pub async fn ytdlp_search(
    query: String,
    max_results: Option<u32>,
    catalog: Option<bool>,
) -> Result<Vec<YtdlpSearchResult>, String> {
    tauri::async_runtime::spawn_blocking(move || search(query, max_results, catalog.unwrap_or(false)))
        .await
        .map_err(|e| e.to_string())?
}

fn search(query: String, max_results: Option<u32>, catalog: bool) -> Result<Vec<YtdlpSearchResult>, String> {
    if query.trim().is_empty() || query.chars().count() > 200 || query.chars().any(char::is_control) {
        return Err("Enter an audio search between 1 and 200 characters.".into());
    }
    let limit = max_results.unwrap_or(10).clamp(1, 50);
    debug!("[yt-dlp] Searching: {} (limit: {})", query, limit);

    let search_url = format!("ytsearch{}:{}", limit, query);
    let args = [
        "--ignore-config",
        "--skip-download",
        "--dump-json",
        "--flat-playlist",
        "--no-warnings",
        "--socket-timeout", "10", "--retries", "1", "--extractor-retries", "1",
        &search_url,
    ];
    let stdout = match run_ytdlp(&args) {
        Ok(stdout) => stdout,
        Err(error) if is_youtube_verification_error(&error) => {
            run_ytdlp_with_client(&args, "android").map_err(friendly_stream_error)?
        }
        Err(error) => return Err(friendly_stream_error(error)),
    };

    let all_results: Vec<YtdlpSearchResult> = parse_ndjson_entries(&stdout)
        .into_iter()
        .filter_map(|entry| {
            entry.id.map(|id| YtdlpSearchResult {
                id: id.clone(),
                title: entry.title.unwrap_or_else(|| "Unknown".to_string()),
                duration: entry.duration,
                thumbnail: entry
                    .thumbnail
                    .or_else(|| Some(format!("https://i.ytimg.com/vi/{id}/hqdefault.jpg"))),
                channel: entry.channel,
                track: entry.track,
                artist: entry
                    .artist
                    .or_else(|| entry.artists.map(|artists| artists.join(", "))),
                album: entry.album,
            })
        })
        .collect();

    // Apply music classification filter
    let results: Vec<YtdlpSearchResult> = all_results
        .into_iter()
        .filter(|result| {
            // Catalog resolution applies title/artist/version/duration matching in
            // the shared resolver; browsing heuristics must not discard its inputs.
            let is_music = catalog || is_likely_music(result);
            if !is_music {
                debug!(
                    "[yt-dlp] Filtered out non-music: '{}' by '{}'",
                    result.title,
                    result.channel.as_deref().unwrap_or("Unknown")
                );
            }
            is_music
        })
        .collect();

    debug!(
        "[yt-dlp] Found {} results ({} after filtering)",
        results.len(),
        results.len()
    );
    Ok(results)
}

#[tauri::command]
pub async fn ytdlp_get_stream(video_id: String) -> Result<YtdlpStreamInfo, String> {
    if video_id.len() != 11
        || !video_id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
    {
        return Err("Invalid YouTube source ID.".into());
    }
    tauri::async_runtime::spawn_blocking(move || resolve(video_id))
        .await
        .map_err(|e| e.to_string())?
}

fn resolve(video_id: String) -> Result<YtdlpStreamInfo, String> {
    resolve_audio(video_id, "bestaudio[ext=m4a][vcodec=none]/bestaudio[ext=webm][vcodec=none]/bestaudio[vcodec=none]")
}

#[cfg_attr(target_os = "android", allow(dead_code))]
pub async fn download_audio(video_id: String) -> Result<YtdlpStreamInfo, String> {
    if video_id.len() != 11
        || !video_id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
    {
        return Err("Invalid YouTube source ID.".into());
    }
    // Store a native-playable audio container without conversion or video tracks.
    tokio::time::timeout(
        std::time::Duration::from_secs(60),
        tauri::async_runtime::spawn_blocking(move || resolve_audio(video_id, "bestaudio[ext=m4a][vcodec=none]")),
    )
    .await
    .map_err(|_| "YouTube audio lookup timed out. Try again when online.".to_string())?
    .map_err(|e| e.to_string())?
}

fn resolve_audio(video_id: String, format: &str) -> Result<YtdlpStreamInfo, String> {
    let url = format!("https://www.youtube.com/watch?v={}", video_id);

    debug!("[yt-dlp] Getting stream for: {}", url);

    let args = [
        "--ignore-config",
        "--skip-download",
        "-f",
        format,
        "--socket-timeout",
        "10",
        "--retries",
        "2",
        "--extractor-retries",
        "2",
        "--dump-json",
        "--no-playlist",
        "--no-warnings",
        &url,
    ];

    let stdout = match run_ytdlp(&args) {
        Ok(stdout) => stdout,
        Err(error) if is_youtube_verification_error(&error) => {
            // Changing client must never broaden an audio-only request into video.
            let fallback_args = [
                "--ignore-config",
                "--skip-download",
                "-f",
                format,
                "--socket-timeout",
                "10",
                "--retries",
                "2",
                "--extractor-retries",
                "2",
                "--dump-json",
                "--no-playlist",
                "--no-warnings",
                &url,
            ];
            run_ytdlp_with_client(&fallback_args, "android").map_err(friendly_stream_error)?
        }
        Err(error) => return Err(friendly_stream_error(error)),
    };

    let info: YtdlpJson = serde_json::from_str(&stdout).map_err(|error| {
        error!("[yt-dlp] Failed to parse output: {}", error);
        format!("Failed to parse yt-dlp output: {}", error)
    })?;

    let stream_url = info.url.ok_or_else(|| {
        error!("[yt-dlp] No URL in output");
        "No stream URL returned by yt-dlp".to_string()
    })?;

    validate_stream_url(&stream_url)?;
    validate_audio_codecs(info.acodec.as_deref(), info.vcodec.as_deref())?;
    debug!(
        "[yt-dlp] Got stream for '{}', duration: {:?}s",
        info.title.as_deref().unwrap_or("Unknown"),
        info.duration
    );

    Ok(YtdlpStreamInfo {
        stream_url,
        duration: info.duration,
        title: info.title,
        container: info.ext,
        codec: info.acodec,
        video_codec: info.vcodec,
        track: info.track,
        artist: info
            .artist
            .or_else(|| info.artists.map(|artists| artists.join(", "))),
        album: info.album,
    })
}

pub(crate) fn validate_audio_codecs(audio: Option<&str>, video: Option<&str>) -> Result<(), String> {
    if audio.is_none_or(|codec| codec.is_empty() || codec == "none") || video != Some("none") {
        return Err("The provider did not verify an audio-only stream. Video downloads are not allowed for music.".into());
    }
    Ok(())
}

fn validate_stream_url(value: &str) -> Result<(), String> {
    let url = reqwest::Url::parse(value).map_err(|_| "Stream extraction returned an invalid audio URL.")?;
    if url.scheme() != "https" || !url.host_str().is_some_and(|host| host == "googlevideo.com" || host.ends_with(".googlevideo.com"))
        || !url.username().is_empty() || url.password().is_some() || url.port_or_known_default() != Some(443) {
        return Err("Stream extraction returned an unsupported audio URL. Refresh the streaming engine and retry.".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn ytdlp_check_available() -> bool {
    if find_ytdlp().is_err() { crate::components::auto_update().await; }
    else { tauri::async_runtime::spawn(crate::components::auto_update()); }
    tauri::async_runtime::spawn_blocking(|| {
        let Ok(engine) = find_ytdlp() else { return false; };
        if crate::components::test_executable(&engine, &["--version"]).is_err() { return false; }
        if let Some(runtime) = crate::components::managed_runtime(&engine) {
            return crate::components::test_executable(&runtime, &["-e", "if (6 * 7 !== 42) throw Error('Runtime test failed')"]).is_ok();
        }
        true
    }).await.unwrap_or(false)
}

#[cfg(test)]
mod tests {
    #[test]
    fn accepts_only_verified_audio_without_video() {
        assert!(super::validate_audio_codecs(Some("mp4a.40.2"),Some("none")).is_ok());
        assert!(super::validate_audio_codecs(Some("opus"),Some("none")).is_ok());
        for (audio,video) in [(Some("aac"),Some("h264")),(Some("aac"),None),(None,Some("none")),(Some("none"),Some("none"))] {
            assert!(super::validate_audio_codecs(audio,video).is_err());
        }
    }
    use super::*;
    #[test]
    fn extracted_streams_reject_invalid_hosts_and_preserve_signed_queries() {
        assert!(validate_stream_url("https://rr1.googlevideo.com/videoplayback?expire=123&sig=a%2Fb").is_ok());
        for url in ["http://rr1.googlevideo.com/audio", "https://googlevideo.com.evil.test/audio", "file:///audio", "https://u:p@rr1.googlevideo.com/audio", "https://rr1.googlevideo.com:123/audio"] {
            assert!(validate_stream_url(url).is_err());
        }
    }
    fn entry(title: &str, channel: &str) -> YtdlpSearchResult {
        YtdlpSearchResult {
            id: "abcdefghijk".into(),
            title: title.into(),
            duration: Some(173.0),
            thumbnail: None,
            channel: Some(channel.into()),
            track: None,
            artist: None,
            album: None,
        }
    }
    #[test]
    fn generic_official_channels_and_substrings_are_not_music_evidence() {
        assert!(!is_likely_music(&entry(
            "Deep cleaning my kitchen",
            "Official Channel"
        )));
        assert!(!is_likely_music(&entry(
            "New visual design",
            "Music Talk Official"
        )));
        assert!(!is_likely_music(&entry(
            "How to play Snowman (Official Audio)",
            "SiaVEVO"
        )));
        assert!(!is_likely_music(&entry("Snowman reaction", "Sia - Topic")));
    }
    #[test]
    fn recognizes_topic_vevo_and_explicit_music_labels() {
        assert!(is_likely_music(&entry("EMIWAY- MACHAYENGE (PROD BY.TONY JAMES)", "Emiway Bantai")));
        assert!(!is_likely_music(&entry("EMIWAY- MACHAYENGE reaction (PROD BY.TONY JAMES)", "Reaction channel")));
        assert!(is_likely_music(&entry(
            "Alaakaa Loova Lyrical (Tamil) | OM | Dhanush",
            "Divo Music and 3 more"
        )));
        assert!(is_likely_music(&entry("Snowman", "Sia - Topic")));
        assert!(is_likely_music(&entry("Sia - Snowman", "SiaVEVO")));
        assert!(is_likely_music(&entry(
            "Sia - Snowman (Official Audio)",
            "Sia"
        )));
    }

    #[test]
    fn recognizes_youtube_verification_errors_without_requiring_cookies() {
        assert!(is_youtube_verification_error(
            "Sign in to confirm you're not a bot"
        ));
        assert!(is_youtube_verification_error(
            "Please verify you are not a bot"
        ));
        assert!(!is_youtube_verification_error(
            "Requested format is not available"
        ));
        assert_eq!(
            friendly_stream_error("Sign in to confirm you're not a bot".into()),
            "YouTube asked for verification and did not provide a playable stream. Try another upload or retry later."
        );
    }
}
