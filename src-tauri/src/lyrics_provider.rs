use crate::{clean_artist_for_lyrics, lyric_identity, provider_http, LyricResult};
use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Record {
    #[serde(default)]
    id: Option<u64>,
    #[serde(default)]
    album_name: String,
    track_name: String,
    artist_name: String,
    duration: f64,
    #[serde(default)]
    instrumental: bool,
    synced_lyrics: Option<String>,
    plain_lyrics: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchInfo {
    pub id: serde_json::Value,
    pub provider: &'static str,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub duration: f64,
}

fn match_info(record: &Record) -> Option<MatchInfo> {
    Some(MatchInfo {
        id: serde_json::json!(record.id?),
        provider: "lrclib",
        title: record.track_name.clone(),
        artist: record.artist_name.clone(),
        album: record.album_name.clone(),
        duration: record.duration,
    })
}

fn synced(record: &Record) -> bool {
    record
        .synced_lyrics
        .as_ref()
        .is_some_and(|s| !s.trim().is_empty())
}

fn native_text(record: &Record) -> bool {
    lyric_identity::script(
        record
            .synced_lyrics
            .as_deref()
            .or(record.plain_lyrics.as_deref())
            .unwrap_or_default(),
    ) != "Latin / other"
}

fn timing_compatible(record: &Record, duration: f64) -> bool {
    if !duration.is_finite() || !record.duration.is_finite() || duration <= 0.0 || record.duration <= 0.0 || (record.duration - duration).abs() > 2.0 {
        return false;
    }
    let Some(lrc) = record
        .synced_lyrics
        .as_deref()
        .filter(|s| !s.trim().is_empty())
    else {
        return false;
    };
    static STAMP: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let stamps = STAMP
        .get_or_init(|| regex::Regex::new(r"\[(\d{1,3}):([0-5]\d)(?:[.:](\d{1,3}))?\]").unwrap());
    let mut count = 0;
    static OFFSET: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let mut offset=0.0;
    for tag in OFFSET.get_or_init(|| regex::Regex::new(r"(?im)^\s*\[offset:([+-]?\d+)\]\s*$").unwrap()).captures_iter(lrc) {
        let Ok(value)=tag[1].parse::<i64>() else { return false };
        if !(-86400000..=86400000).contains(&value) { return false; }
        offset=value as f64/1000.0;
    }
    for stamp in stamps.captures_iter(lrc) {
        let seconds =
            stamp[1].parse::<f64>().unwrap_or(0.0) * 60.0 + stamp[2].parse::<f64>().unwrap_or(0.0)
                + stamp.get(3).map(|fraction| format!("0.{}",fraction.as_str()).parse::<f64>().unwrap_or(0.0)).unwrap_or(0.0);
        if seconds + offset > duration + 2.0 {
            return false;
        }
        count += 1;
    }
    static WORD: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    for stamp in WORD.get_or_init(||regex::Regex::new(r"<(\d{1,3}):([0-5]\d)(?:[.:](\d{1,3}))?>").unwrap()).captures_iter(lrc) {
        let seconds=stamp[1].parse::<f64>().unwrap()*60.0+stamp[2].parse::<f64>().unwrap()+stamp.get(3).map(|fraction|format!("0.{}",fraction.as_str()).parse::<f64>().unwrap()).unwrap_or(0.0);
        if seconds+offset>duration+2.0{return false;}
    }
    count > 0 && plain_text(record).is_some()
}

fn version_labels(title: &str) -> Vec<String> {
    static LABELS: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let mut labels: Vec<_> = LABELS.get_or_init(||regex::Regex::new(r"(?i)\b(?:live|remix|acoustic|instrumental|karaoke|cover|demo|remaster(?:ed)?|radio\s+edit|extended|slowed|sped\s+up|female|male)\b").unwrap()).find_iter(title).map(|label|label.as_str().to_lowercase()).collect();
    labels.sort();labels.dedup();labels
}
fn lyric_title(title: &str) -> String {
    let mut prepared=lyric_identity::query_title(title);
    for label in version_labels(title) { if !version_labels(&prepared).contains(&label) { prepared.push_str(&format!(" ({label})")); } }
    prepared
}

fn plain_text(record: &Record) -> Option<String> {
    if let Some(text) = record
        .plain_lyrics
        .as_ref()
        .filter(|s| !s.trim().is_empty())
    {
        return Some(text.clone());
    }
    static TAG: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let tags = TAG.get_or_init(|| regex::Regex::new(r"\[[^\]\r\n]*\]|<\d{1,3}:[0-5]\d(?:[.:]\d{1,3})?>").unwrap());
    let text = record
        .synced_lyrics
        .as_deref()?
        .lines()
        .filter_map(|line| {
            if [
                "[ar:", "[ti:", "[al:", "[by:", "[offset:", "[length:", "[re:", "[ve:",
            ]
            .iter()
            .any(|tag| line.trim_start().starts_with(tag))
            {
                return None;
            }
            let text = tags.replace_all(line, "").trim().to_string();
            (!text.is_empty()).then_some(text)
        })
        .collect::<Vec<_>>()
        .join("\n");
    (!text.trim().is_empty()).then_some(text)
}

fn result(record: Record, duration: f64) -> LyricResult {
    let matched = match_info(&record);
    if timing_compatible(&record, duration) {
        return LyricResult::Synced {
            lrc: record.synced_lyrics.unwrap(),
            matched,
        };
    }
    if let Some(text) = plain_text(&record) {
        LyricResult::Plain { text, matched }
    } else if record.instrumental && duration.is_finite() && record.duration.is_finite() && duration>0.0 && record.duration>0.0 && (record.duration-duration).abs()<=2.0 {
        LyricResult::Instrumental
    } else {
        LyricResult::NotFound
    }
}

fn candidate<'a>(
    records: &'a [Record],
    title: &str,
    artist: &str,
    duration: f64,
) -> Option<&'a Record> {
    if lyric_identity::primary_artist(artist).is_empty() {
        if !duration.is_finite() || duration<=0.0 { return None; }
        let names:std::collections::HashSet<_>=records.iter().filter(|record|has_content(record)
            && lyric_identity::title(&lyric_title(&record.track_name))==lyric_identity::title(&lyric_title(title))
            && version_labels(&record.track_name)==version_labels(title)
            && record.duration.is_finite()&&(record.duration-duration).abs()<=2.0)
            .map(|record|lyric_identity::fingerprint(&record.artist_name)).filter(|name|!name.is_empty()).collect();
        if names.len()!=1 { return None; }
    }
    records
        .iter()
        .filter(|r| {
            version_labels(&r.track_name) == version_labels(title)
                && r.duration.is_finite() && r.duration >= 0.0
                && lyric_identity::title(&lyric_title(&r.track_name)) == lyric_identity::title(&lyric_title(title))
                && ((lyric_identity::primary_artist(artist).is_empty() && duration>0.0 && (r.duration-duration).abs()<=2.0)
                    || lyric_identity::artists_match(&r.artist_name, artist)
                    || ((r.duration - duration).abs() <= 2.0
                        && duration > 0.0
                        && artist_name_extension(&r.artist_name, artist)))
                && (r.instrumental
                    || r.synced_lyrics
                        .as_ref()
                        .is_some_and(|v| !v.trim().is_empty())
                    || r.plain_lyrics
                        .as_ref()
                        .is_some_and(|v| !v.trim().is_empty()))
        })
        .min_by(|a, b| {
            let gap = |r: &Record| {
                if duration > 0.0 {
                    (r.duration - duration).abs()
                } else {
                    0.0
                }
            };
            // Closest recording first; at equal duration prefer synchronized lyrics.
            timing_compatible(b, duration)
                .cmp(&timing_compatible(a, duration))
                .then_with(|| gap(a).total_cmp(&gap(b)))
                .then_with(|| synced(b).cmp(&synced(a)))
                .then_with(|| native_text(b).cmp(&native_text(a)))
        })
}

// Accept a complete name token, such as Emiway / Emiway Bantai, only when
// title and recording duration also agree. Substrings and cover labels fail.
fn artist_name_extension(left: &str, right: &str) -> bool {
    let tokens = |name: &str| -> Vec<String> {
        name.to_lowercase()
            .split(|c: char| !c.is_alphanumeric())
            .filter(|token| !token.is_empty())
            .map(str::to_string)
            .collect()
    };
    lyric_identity::credits(left).iter().any(|left| {
        lyric_identity::credits(right).iter().any(|right| {
            let a = tokens(left);
            let b = tokens(right);
            let (short, long) = if a.len() < b.len() {
                (&a, &b)
            } else {
                (&b, &a)
            };
            !short.is_empty()
                && short != long
                && short[0].chars().count() >= 4
                && long.starts_with(short)
                && long.len() - short.len() <= 2
                && !long
                    .iter()
                    .any(|word| ["cover", "tribute", "karaoke", "remix"].contains(&word.as_str()))
        })
    })
}

pub async fn fetch(
    title: String,
    artist: String,
    album: String,
    duration: f64,
) -> Result<LyricResult, String> {
    fetch_with_fallback("https://lrclib.net/api", "https://lrc.red", title, artist, album, duration).await
}

async fn fetch_with_fallback(
    primary: &str,
    backup: &str,
    title: String,
    artist: String,
    album: String,
    duration: f64,
) -> Result<LyricResult, String> {
    if !duration.is_finite() || title.len() > 2000 || artist.len() > 2000 || album.len() > 2000 {
        return Err("Invalid track information for lyrics lookup.".into());
    }
    let original = tokio::time::timeout(std::time::Duration::from_secs(30),
        fetch_from(primary, title.clone(), artist.clone(), album, duration)).await
        .unwrap_or_else(|_| Err("LRCLIB lookup timed out. Please retry.".into()));
    if let Ok(LyricResult::Synced { lrc, .. }) = &original {
        if !lrc.contains('<') {
            // A bounded enrichment attempt must never discard working line lyrics on failure.
            if let Ok(Ok(found @ LyricResult::Synced { .. })) = tokio::time::timeout(
                std::time::Duration::from_secs(3), fetch_red(backup, &title, &artist, duration)
            ).await {
                if matches!(&found, LyricResult::Synced { lrc, .. } if lrc.contains('<')) { return Ok(found); }
            }
        }
        return original;
    }
    if matches!(&original, Ok(LyricResult::Instrumental)) {
        return original;
    }
    let fallback = tokio::time::timeout(std::time::Duration::from_secs(18),
        fetch_red(backup, &title, &artist, duration)).await
        .unwrap_or_else(|_| Err("lrc.red lookup timed out. Please retry.".into()));
    match (original, fallback) {
        (_, Ok(found @ LyricResult::Synced { .. })) => Ok(found),
        (Ok(plain @ LyricResult::Plain { .. }), _) => Ok(plain),
        (Err(primary), Err(backup)) => {
            log::warn!("Lyrics providers failed: {primary}; {backup}");
            Err("Couldn't load lyrics from LRCLIB or lrc.red. Check your connection or retry.".into())
        },
        (Err(error), _) => {
            log::warn!("LRCLIB failed; lrc.red found no verified match: {error}");
            Err("LRCLIB couldn't complete the lookup, and lrc.red found no matching lyrics. Please retry.".into())
        },
        (_, Err(error)) => {
            log::warn!("LRCLIB found no verified match; lrc.red failed: {error}");
            Err("LRCLIB found no matching lyrics, and lrc.red couldn't complete the lookup. Please retry.".into())
        },
        _ => Ok(LyricResult::NotFound),
    }
}

#[derive(Deserialize)]
struct RedHit {
    isrc: String,
    title: String,
    artist: String,
    #[serde(default)]
    album: String,
    duration: f64,
}

async fn fetch_red(base: &str, title: &str, artist: &str, duration: f64) -> Result<LyricResult, String> {
    let prepared = lyric_title(title);
    let (artist, title) = clean_artist_for_lyrics(artist, &prepared);
    let primary = lyric_identity::primary_artist(&artist);
    // Without recording duration and artist evidence, search results are too ambiguous.
    if title.is_empty() || primary.is_empty() || !(1.0..=3600.0).contains(&duration) {
        return Ok(LyricResult::NotFound);
    }
    let response = provider_http::get(&format!("{base}/search.json"), &[("q", format!("{title} {primary}"))]).await?;
    if !response.status().is_success() {
        return Err(format!("lrc.red search is unavailable (HTTP {}). Please retry.", response.status()));
    }
    let body = bounded_red_text(response).await?;
    let search: serde_json::Value = serde_json::from_str(&body)
        .map_err(|_| "lrc.red returned invalid search results.")?;
    let hits = search.get("hits").and_then(|v| v.as_array())
        .filter(|hits| hits.len() <= 100).ok_or("lrc.red returned invalid search results.")?;
    let mut candidates: Vec<RedHit> = hits.iter().filter_map(|hit| serde_json::from_value(hit.clone()).ok())
        .filter(|hit: &RedHit| {
            valid_isrc(&hit.isrc) && hit.title.len() <= 2000 && hit.artist.len() <= 2000 && hit.album.len() <= 2000
                && hit.duration.is_finite() && (hit.duration - duration).abs() <= 2.0
                && lyric_identity::title(&lyric_title(&hit.title)) == lyric_identity::title(&lyric_title(&title))
                && version_labels(&hit.title) == version_labels(&title)
                && (lyric_identity::artists_match(&hit.artist, &artist) || artist_name_extension(&hit.artist, &artist))
        }).collect();
    candidates.sort_by(|a, b| (a.duration - duration).abs().total_cmp(&(b.duration - duration).abs()));
    let mut error = None;
    let mut seen = std::collections::HashSet::new();
    for hit in candidates.into_iter().filter(|hit| seen.insert(hit.isrc.clone())).take(3) {
        let attempt = async {
            let response = provider_http::get(&format!("{base}/s/{}.lrc", hit.isrc), &[]).await?;
            if response.status() == reqwest::StatusCode::NOT_FOUND { return Ok(None); }
            if !response.status().is_success() {
                return Err(format!("lrc.red lyrics are unavailable (HTTP {}). Please retry.", response.status()));
            }
            let raw = bounded_red_text(response).await?;
            let lrc = raw;
            let record = Record { id: None, album_name: hit.album.clone(), track_name: hit.title.clone(),
                artist_name: hit.artist.clone(), duration: hit.duration, instrumental: false,
                synced_lyrics: Some(lrc.clone()), plain_lyrics: None };
            if lrc.trim_start().starts_with('<') || !timing_compatible(&record, duration) || plain_text(&record).is_none() {
                return Err("lrc.red returned invalid or incompatible lyric timing. Please retry.".into());
            }
            Ok(Some(LyricResult::Synced { lrc, matched: Some(MatchInfo {
                id: serde_json::json!(hit.isrc), provider: "lrc.red", title: hit.title.clone(),
                artist: hit.artist.clone(), album: hit.album.clone(), duration: hit.duration,
            }) }))
        }.await;
        match attempt {
            Ok(Some(found)) => return Ok(found),
            Ok(None) => (),
            Err(message) => error = Some(message),
        }
    }
    error.map_or(Ok(LyricResult::NotFound), Err)
}

fn valid_isrc(value: &str) -> bool {
    value.len() == 12 && value.bytes().all(|b| b.is_ascii_uppercase() || b.is_ascii_digit())
        && value.as_bytes()[..2].iter().all(u8::is_ascii_uppercase)
}

async fn bounded_red_text(mut response: reqwest::Response) -> Result<String, String> {
    const LIMIT: usize = 512 * 1024;
    if response.content_length().is_some_and(|length| length > LIMIT as u64) {
        return Err("lrc.red response is too large.".into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "Could not read lrc.red response. Please retry.")? {
        if bytes.len() + chunk.len() > LIMIT { return Err("lrc.red response is too large.".into()); }
        bytes.extend_from_slice(&chunk);
    }
    String::from_utf8(bytes).map_err(|_| "lrc.red returned invalid text.".into())
}

async fn fetch_from(
    base: &str,
    title: String,
    artist: String,
    album: String,
    duration: f64,
) -> Result<LyricResult, String> {
    if !duration.is_finite() || title.len() > 2000 || artist.len() > 2000 || album.len() > 2000 {
        return Err("Invalid track information for lyrics lookup.".into());
    }
    // Remove film decorations before trying Artist - Song extraction.
    let prepared_title = lyric_title(&title);
    let (artist, title) = clean_artist_for_lyrics(&artist, &prepared_title);
    if title.trim().is_empty() {
        return Ok(LyricResult::NotFound);
    }
    // Serializing requests prevents track switches from flooding the provider.
    static GATE: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
    let _guard = GATE.lock().await;
    let mut params = vec![
        ("track_name", title.clone()),
        ("artist_name", lyric_identity::primary_artist(&artist)),
    ];
    if !["", "youtube", "local collection", "unknown album"]
        .contains(&album.trim().to_lowercase().as_str())
    {
        params.push(("album_name", album.trim().to_string()));
    }
    if (1.0..=3600.0).contains(&duration) {
        params.push(("duration", format!("{duration:.0}")));
    }
    let mut fallback = None;
    let mut invalid_exact = false;
    let mut status = reqwest::StatusCode::NOT_FOUND;
    if !lyric_identity::primary_artist(&artist).is_empty() {
        let response = provider_http::get(&format!("{base}/get"), &params).await?;
        status = response.status();
        if status.is_success() {
            match response.json::<Record>().await {
                Ok(record) => {
                    if has_content(&record) && candidate(std::slice::from_ref(&record), &title, &artist, duration).is_some() {
                        if timing_compatible(&record, duration) { return Ok(result(record, duration)); }
                        fallback = Some(record);
                    }
                },
                Err(_) => invalid_exact = true,
            }
        } else if status.is_server_error() {
            // The exact endpoint and search can have different cache/load paths.
            // Try search after the final short cooldown, never bypassing 429/auth
            // responses or a long/unparseable Retry-After directive.
            let delay = response
                .headers()
                .get("retry-after")
                .map(|v| v.to_str().ok().and_then(|v| v.parse::<u64>().ok()));
            match delay {
                None => tokio::time::sleep(std::time::Duration::from_secs(1)).await,
                Some(Some(seconds)) if seconds <= 5 => {
                    tokio::time::sleep(std::time::Duration::from_secs(seconds.max(1))).await
                }
                _ => {
                    return Err(format!(
                        "LRCLIB is temporarily unavailable (HTTP {status}). Please retry later."
                    ))
                }
            }
        } else if status != reqwest::StatusCode::NOT_FOUND {
            // Temporary failures must remain retryable errors, not cached misses.
            return Err(format!(
                "LRCLIB is temporarily unavailable (HTTP {status}). Please retry shortly."
            ));
        }
    }
    let mut records = search_records(base, &title, &artist, duration)
        .await
        .or_else(|error| {
            if let Some(record) = fallback.take() {
                Ok(vec![record])
            } else {
                Err(error)
            }
        })?;
    if let Some(record) = fallback {
        records.push(record);
    }
    if let Some(record) = candidate(&records, &title, &artist, duration) {
        let index = records
            .iter()
            .position(|r| std::ptr::eq(r, record))
            .unwrap();
        return Ok(result(records.swap_remove(index), duration));
    }
    if invalid_exact { return Err("LRCLIB couldn't read the exact record and search found no verified match. Please retry.".into()); }
    if status.is_server_error() {
        return Err(format!("LRCLIB exact lookup was unavailable (HTTP {status}) and search found no verified match. Please retry."));
    }
    Ok(LyricResult::NotFound)
}

async fn search_records(base: &str, title: &str, artist: &str, duration: f64) -> Result<Vec<Record>, String> {
    let primary = lyric_identity::primary_artist(artist);
    let mut queries = vec![primary];
    if !queries[0].is_empty() {
        queries.push(String::new());
    }
    let mut records = Vec::new();
    let mut parse_error = None;
    for artist_query in queries {
        let mut params = vec![("track_name", lyric_identity::query_title(title))];
        if !artist_query.is_empty() {
            params.push(("artist_name", artist_query));
        }
        let response = match provider_http::get(&format!("{base}/search"), &params).await {
            Ok(response) => response,
            Err(_) if !records.is_empty() => break,
            Err(error) => return Err(error),
        };
        if !response.status().is_success() {
            if !records.is_empty() { break; }
            return Err(format!(
                "LRCLIB search is unavailable (HTTP {}). Please retry shortly.",
                response.status()
            ));
        }
        let found = match response.json::<serde_json::Value>().await
            .map_err(|_| "LRCLIB couldn't read the search response. Please retry.".to_string())
            .and_then(search_rows) {
                Ok(found) => found,
                Err(error) => { parse_error = Some(error); continue; },
            };
        for record in found {
            if !records
                .iter()
                .any(|existing: &Record| record.id.is_some() && record.id == existing.id)
            {
                records.push(record);
            }
        }
        if candidate(&records, title, artist, duration).is_some_and(|r| timing_compatible(r, duration)) {
            break;
        }
    }
    if records.is_empty() { if let Some(error) = parse_error { return Err(error); } }
    Ok(records)
}

fn search_rows(value: serde_json::Value) -> Result<Vec<Record>, String> {
    let rows = value.as_array().filter(|rows| rows.len() <= 1000)
        .ok_or("LRCLIB couldn't read the search response. Please retry.")?;
    // Community records can have null/malformed metadata; they must not poison valid neighbors.
    let records: Vec<Record> = rows.iter().filter_map(|row| serde_json::from_value(row.clone()).ok())
        .filter(|record: &Record| record.duration.is_finite() && (0.0..=86400.0).contains(&record.duration)
            && record.track_name.len() <= 4000 && record.artist_name.len() <= 4000 && record.album_name.len() <= 4000)
        .collect();
    if !rows.is_empty() && records.is_empty() { return Err("LRCLIB search contained no readable lyric records. Please retry.".into()); }
    Ok(records)
}

fn has_content(record: &Record) -> bool {
    record.instrumental
        || record
            .synced_lyrics
            .as_ref()
            .is_some_and(|s| !s.trim().is_empty())
        || record
            .plain_lyrics
            .as_ref()
            .is_some_and(|s| !s.trim().is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    #[ignore = "explicit Windows audit of sanitized live snapshots"]
    fn audit_live_corpus_snapshots() {
        let root=std::path::Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();
        let data:serde_json::Value=serde_json::from_str(&std::fs::read_to_string(root.join("test-results/lyrics-live-corpus.json")).unwrap()).unwrap();
        let mut results=Vec::new();
        for case in data["cases"].as_array().unwrap() {
            if !case["error"].is_null(){results.push(serde_json::json!({"title":case["queryTitle"],"error":case["error"]}));continue;}
            let title=case["queryTitle"].as_str().unwrap();let artist=case["queryArtist"].as_str().unwrap();
            let observed:serde_json::Value=serde_json::from_str(include_str!("../../tests/fixtures/lyrics-accuracy-corpus.json")).unwrap();
            let seed=observed["cases"].as_array().unwrap().iter().find(|item|item["queryTitle"]==title).unwrap();
            let original=seed["records"].as_array().unwrap().iter().find(|row|lyric_identity::title(row["title"].as_str().unwrap())==lyric_identity::title(title)&&version_labels(row["title"].as_str().unwrap()).is_empty()).unwrap();
            let duration=original["duration"].as_f64().unwrap();
            let records=search_rows(case["records"].clone()).unwrap();
            let selected=candidate(&records,title,artist,duration);
            let before_unsafe=records.iter().filter(|row|lyric_identity::title(&row.track_name)==lyric_identity::title(title)&&lyric_identity::artists_match(&row.artist_name,artist)&&version_labels(&row.track_name)!=version_labels(title)&&(row.duration-duration).abs()<=2.0&&synced(row)).count();
            results.push(serde_json::json!({"title":title,"duration":duration,"candidateCount":records.len(),"selected":selected.map(|row|serde_json::json!({"id":row.id,"title":row.track_name,"artist":row.artist_name,"duration":row.duration,"synchronized":timing_compatible(row,duration)})),"incompatibleVersionEligibilityBefore":before_unsafe,"incompatibleVersionEligibilityAfter":records.iter().filter(|row|version_labels(&row.track_name)!=version_labels(title)&&candidate(std::slice::from_ref(row),title,artist,duration).is_some()).count(),"elapsedMs":case["elapsedMs"]}));
        }
        std::fs::write(root.join("test-results/lyrics-live-audit.json"),serde_json::to_string_pretty(&results).unwrap()).unwrap();
        println!("{}",serde_json::to_string_pretty(&results).unwrap());
    }
    #[test]
    fn retained_real_song_corpus_rejects_alternate_editions_without_lyric_text() {
        let corpus:serde_json::Value=serde_json::from_str(include_str!("../../tests/fixtures/lyrics-accuracy-corpus.json")).unwrap();
        let mut positives=0;let mut negatives=0;let mut legacy_unsafe=0;
        for case in corpus["cases"].as_array().unwrap() {
            let query=case["queryTitle"].as_str().unwrap();
            let rows=case["records"].as_array().unwrap();
            let original=rows.iter().find(|row|lyric_identity::title(row["title"].as_str().unwrap())==lyric_identity::title(query)&&version_labels(row["title"].as_str().unwrap()).is_empty()).unwrap();
            let duration=original["duration"].as_f64().unwrap();let artist=original["artist"].as_str().unwrap();
            for row in rows {
                let record=Record{id:None,album_name:String::new(),track_name:row["title"].as_str().unwrap().into(),artist_name:row["artist"].as_str().unwrap().into(),duration:row["duration"].as_f64().unwrap(),instrumental:false,synced_lyrics:Some("[00:01]Timing fixture".into()),plain_lyrics:None};
                let correct=std::ptr::eq(row,original);
                let accepted=candidate(std::slice::from_ref(&record),query,artist,duration).is_some();
                if correct {positives+=1;assert!(accepted,"{}",record.track_name);} else {
                    negatives+=1;assert!(!accepted,"{}",record.track_name);
                    if lyric_identity::title(&record.track_name)==lyric_identity::title(query)&&lyric_identity::artists_match(&record.artist_name,artist)&&timing_compatible(&record,duration){legacy_unsafe+=1;}
                }
            }
        }
        assert_eq!((positives,negatives,legacy_unsafe),(10,14,1));
        println!("Retained metadata replay: 10/10 positive controls; unsafe alternate synced eligibility 1/14 before, 0/14 after. Synthetic text only; no acoustic accuracy claim.");
    }
    #[test]
    fn timing_guards_include_fraction_offset_and_word_ends_and_preserve_plain_text() {
        for lrc in ["[offset:3000]\n[00:09.500]Timing fixture","[00:12.500]Timing fixture","[00:01]<00:01>Timing fixture<00:13>","[offset:99999999999999999999999999999]\n[00:01]Timing fixture"] {
            let record=Record{id:None,album_name:String::new(),track_name:"Fixture".into(),artist_name:"Artist".into(),duration:10.0,instrumental:false,synced_lyrics:Some(lrc.into()),plain_lyrics:None};
            assert!(!timing_compatible(&record,10.0),"{lrc}");
            assert!(matches!(result(record,10.0),LyricResult::Plain{..}));
        }
        assert_eq!(version_labels(&lyric_title("Despacito (feat. Justin Bieber) [Remix]")),vec!["remix"]);
        let remix=Record{id:None,album_name:String::new(),track_name:"Despacito (feat. Justin Bieber) [Remix]".into(),artist_name:"Luis Fonsi".into(),duration:230.0,instrumental:false,synced_lyrics:Some("[00:01]Timing fixture".into()),plain_lyrics:None};
        assert!(candidate(std::slice::from_ref(&remix),&lyric_title(&remix.track_name),"Luis Fonsi",230.0).is_some());
        assert!(candidate(std::slice::from_ref(&remix),"Despacito","Luis Fonsi",230.0).is_none());
        assert!(candidate(&[],"Missing recording","Artist",200.0).is_none());
    }
    #[test]
    fn unknown_artist_requires_duration_and_unambiguous_performer() {
        let make=|artist:&str,duration:f64|Record{id:None,album_name:String::new(),track_name:"Hello".into(),artist_name:artist.into(),duration,instrumental:false,synced_lyrics:Some("[00:01]Timing fixture".into()),plain_lyrics:None};
        assert!(candidate(&[make("Adele",200.0)],"Hello","",200.0).is_some());
        assert!(candidate(&[make("Adele",200.0),make("Other",200.0)],"Hello","",200.0).is_none());
        assert!(candidate(&[make("Adele",180.0)],"Hello","",200.0).is_none());
        assert!(candidate(&[make("Adele",200.0)],"Hello","",0.0).is_none());
    }
    #[test]
    fn empty_timestamps_are_not_lyrics_and_instrumental_requires_recording_duration() {
        let record=Record{id:None,album_name:String::new(),track_name:"Fixture".into(),artist_name:"Artist".into(),duration:200.0,instrumental:false,synced_lyrics:Some("[00:01]\n[00:02]".into()),plain_lyrics:None};
        assert!(!timing_compatible(&record,200.0));assert!(matches!(result(record.clone(),200.0),LyricResult::NotFound));
        let instrumental=Record{instrumental:true,synced_lyrics:None,..record};
        assert!(matches!(result(instrumental.clone(),200.0),LyricResult::Instrumental));
        assert!(matches!(result(instrumental,230.0),LyricResult::NotFound));
    }

    fn red_hit(id: &str, title: &str, artist: &str, duration: f64) -> serde_json::Value {
        serde_json::json!({"isrc": id, "title": title, "artist": artist, "duration": duration})
    }

    #[test]
    fn null_duration_neighbors_do_not_hide_aaraadhikes_matching_recording() {
        let malformed = serde_json::json!({"id":36684639,"trackName":"Aaraadhike","artistName":"Sooraj Santhosh","duration":null,"syncedLyrics":"[00:01]fixture"});
        let valid = serde_json::json!({"id":32091745,"trackName":"Aaraadhike","artistName":"Sooraj Santhosh","albumName":"Ambili (Original Motion Picture Soundtrack)","duration":357,"syncedLyrics":"[00:01]fixture"});
        let rows = search_rows(serde_json::json!([malformed, valid])).unwrap();
        let found = candidate(&rows, "Aaraadhike", "Sooraj Santhosh, Madhuvanthi Narayan", 357.0).unwrap();
        assert_eq!(found.id, Some(32091745));
        assert!(timing_compatible(found, 357.0));
        assert!(search_rows(serde_json::json!([{"duration":null}])).is_err());
        assert!(search_rows(serde_json::json!([])).unwrap().is_empty());
    }
    #[test]
    fn malformed_exact_and_artist_search_can_recover_via_title_search() {
        let found = r#"[{"id":32091745,"trackName":"Aaraadhike","artistName":"Sooraj Santhosh","duration":357,"syncedLyrics":"[00:01]fixture"},{"duration":null}]"#;
        let (base, server) = provider_http::tests::server(vec![("200 OK", "{\"duration\":null}".into()), ("200 OK", "{\"error\":true}".into()), ("200 OK", found.into())]);
        let runtime = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        let result = runtime.block_on(fetch_with_fallback(&base, "http://127.0.0.1:1", "Aaraadhike".into(), "Sooraj Santhosh, Madhuvanthi Narayan".into(), "Ambili".into(), 357.0)).unwrap();
        assert!(matches!(result, LyricResult::Synced { matched: Some(MatchInfo { provider: "lrclib", .. }), .. }));
        let requests = server.join().unwrap();
        assert_eq!(requests.len(), 3);
        assert!(!requests[2].contains("artist_name"));
    }
    #[test]
    #[ignore = "explicit Aaraadhike public-provider regression; requires network"]
    fn live_aaraadhike_matches_357_second_recording() {
        let runtime = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        let result = runtime.block_on(fetch("Aaraadhike".into(), "Sooraj Santhosh, Madhuvanthi Narayan".into(), "Ambili (Original Motion Picture Soundtrack)".into(), 357.0)).unwrap();
        match result {
            LyricResult::Synced { matched: Some(matched), .. } => {
                assert!((matched.duration - 357.0).abs() <= 2.0);
                println!("Matched provider={}, record={}, duration={}", matched.provider, matched.id, matched.duration);
            },
            _ => panic!("Expected synchronized lyrics for the verified Aaraadhike recording"),
        }
    }
    #[test]
    fn fallback_rejects_wrong_recordings_and_continues_after_bad_files() {
        let hits = serde_json::json!({"hits": [
            red_hit("INAAA2400001", "Song (Live)", "Artist", 200.0),
            red_hit("INAAA2400002", "Song", "Cover Artist", 200.0),
            red_hit("INAAA2400003", "Song", "Artist", 220.0),
            red_hit("../../unsafe", "Song", "Artist", 200.0),
            {"isrc": "INAAA2400004", "title": "Song"},
            red_hit("INAAA2400005", "Song", "Artist", 200.0),
            red_hit("INAAA2400006", "Song", "Artist, Guest", 201.0),
        ]});
        let (base, server) = provider_http::tests::server(vec![
            ("200 OK", hits.to_string()),
            ("200 OK", "<html>challenge</html>".into()),
            ("200 OK", "[00:01.00]<00:01.00>வணக்கம் <00:01.50>fixture\n[00:02.00]fixture".into()),
        ]);
        let runtime = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        let found = runtime.block_on(fetch_red(&base, "Song", "Artist", 200.0)).unwrap();
        match found {
            LyricResult::Synced { lrc, matched: Some(info) } => {
                assert!(lrc.contains("வணக்கம்"));
                assert!(lrc.contains('<'));
                assert!(lrc.contains("[00:01.00]"));
                assert_eq!(info.provider, "lrc.red");
                assert_eq!(info.id, serde_json::json!("INAAA2400006"));
            }
            _ => panic!("Expected verified fallback"),
        }
        let requests = server.join().unwrap();
        assert_eq!(requests.len(), 3);
        assert!(requests[1].starts_with("GET /s/INAAA2400005.lrc"));
        assert!(requests[2].starts_with("GET /s/INAAA2400006.lrc"));
    }

    #[test]
    fn provider_chain_keeps_primary_synced_and_recovers_primary_errors() {
        let runtime = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        let record = r#"{"id":42,"trackName":"Song","artistName":"Artist","duration":200,"syncedLyrics":"[00:01]fixture"}"#;
        let (primary, server) = provider_http::tests::server(vec![("200 OK", record.into())]);
        let found = runtime.block_on(fetch_with_fallback(&primary, "http://127.0.0.1:1", "Song".into(), "Artist".into(), "".into(), 200.0)).unwrap();
        assert!(matches!(found, LyricResult::Synced { matched: Some(MatchInfo { provider: "lrclib", .. }), .. }));
        assert_eq!(server.join().unwrap().len(), 1);

        for (status, body) in [("403 Forbidden", "blocked"), ("200 OK", "malformed json")] {
            let mut responses = vec![(status, body.into())];
            if status == "200 OK" { responses.extend([("200 OK", "[]".into()), ("200 OK", "[]".into())]); }
            let (primary, first) = provider_http::tests::server(responses);
            let hits = serde_json::json!({"hits": [red_hit("INAAA2400001", "Song", "Artist", 200.0)]});
            let (backup, second) = provider_http::tests::server(vec![("200 OK", hits.to_string()), ("200 OK", "[00:01]fixture".into())]);
            let found = runtime.block_on(fetch_with_fallback(&primary, &backup, "Song".into(), "Artist".into(), "".into(), 200.0)).unwrap();
            assert!(matches!(found, LyricResult::Synced { matched: Some(MatchInfo { provider: "lrc.red", .. }), .. }));
            first.join().unwrap(); second.join().unwrap();
        }
    }

    #[test]
    fn enriches_line_lyrics_only_with_verified_word_data() {
        let runtime = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        for (text, expected) in [("[00:01]<00:01>fixture<00:02>", "lrc.red"), ("[00:01]fixture", "lrclib")] {
            let record = r#"{"id":42,"trackName":"Song","artistName":"Artist","duration":200,"syncedLyrics":"[00:01]fixture"}"#;
            let (primary, first) = provider_http::tests::server(vec![("200 OK", record.into())]);
            let hits = serde_json::json!({"hits": [red_hit("INAAA2400001", "Song", "Artist", 200.0)]});
            let (backup, second) = provider_http::tests::server(vec![("200 OK", hits.to_string()), ("200 OK", text.into())]);
            let found = runtime.block_on(fetch_with_fallback(&primary, &backup, "Song".into(), "Artist".into(), "".into(), 200.0)).unwrap();
            assert!(matches!(found, LyricResult::Synced { matched: Some(info), .. } if info.provider == expected));
            first.join().unwrap(); second.join().unwrap();
        }
    }

    #[test]
    fn fallback_misses_and_failures_preserve_plain_text_and_retryable_errors() {
        let runtime = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        for primary_plain in [true, false] {
            let plain = r#"{"id":42,"trackName":"Song","artistName":"Artist","duration":200,"syncedLyrics":null,"plainLyrics":"fixture"}"#;
            let first_response = if primary_plain { ("200 OK", plain.into()) } else { ("404 Not Found", "".into()) };
            let (primary, first) = provider_http::tests::server(vec![first_response, ("200 OK", "[]".into()), ("200 OK", "[]".into())]);
            let (backup, second) = provider_http::tests::server(vec![("403 Forbidden", "blocked".into())]);
            let found = runtime.block_on(fetch_with_fallback(&primary, &backup, "Song".into(), "Artist".into(), "".into(), 200.0));
            if primary_plain { assert!(matches!(found, Ok(LyricResult::Plain { .. }))); }
            else { assert!(found.unwrap_err().contains("lrc.red")); }
            first.join().unwrap(); second.join().unwrap();
        }
        let (primary, first) = provider_http::tests::server(vec![("404 Not Found", "".into()), ("200 OK", "[]".into()), ("200 OK", "[]".into())]);
        let (backup, second) = provider_http::tests::server(vec![("200 OK", "{\"hits\":[]}".into())]);
        assert!(matches!(runtime.block_on(fetch_with_fallback(&primary, &backup, "Song".into(), "Artist".into(), "".into(), 200.0)), Ok(LyricResult::NotFound)));
        first.join().unwrap(); second.join().unwrap();
    }

    #[test]
    fn fallback_bounds_text_and_rejects_invalid_timing() {
        let runtime = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        for text in ["[99:00]fixture".to_string(), "[00:01]".into(), "no timing".into(), "x".repeat(512 * 1024 + 1)] {
            let hits = serde_json::json!({"hits": [red_hit("INAAA2400001", "Song", "Artist", 200.0)]});
            let (base, server) = provider_http::tests::server(vec![("200 OK", hits.to_string()), ("200 OK", text)]);
            assert!(runtime.block_on(fetch_red(&base, "Song", "Artist", 200.0)).is_err());
            server.join().unwrap();
        }
        assert!(matches!(runtime.block_on(fetch_red("http://127.0.0.1:1", "Song", "", 200.0)), Ok(LyricResult::NotFound)));
        assert!(matches!(runtime.block_on(fetch_red("http://127.0.0.1:1", "Song", "Artist", 0.0)), Ok(LyricResult::NotFound)));
    }

    #[test]
    #[ignore = "explicit lrc.red live check; requires network"]
    fn live_red_multilingual() {
        let runtime = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        for (title, artist, duration) in [
            ("Yedi", "Dhanush", 201.618),
            ("Darshana", "Hesham Abdul Wahab", 225.116),
            ("Inkem Inkem Inkem Kaavaale", "Sid Sriram", 266.715),
            ("Tum Hi Ho", "Arijit Singh", 261.974),
            ("Despacito", "Luis Fonsi", 230.467),
            ("Spring Day", "BTS", 274.0),
        ] {
            let result = runtime.block_on(fetch_red("https://lrc.red", title, artist, duration)).unwrap();
            assert!(matches!(result, LyricResult::Synced { .. }), "{title}");
        }
    }
    fn record(title: &str, artist: &str, duration: f64, synced: bool) -> Record {
        Record {
            id: None,
            album_name: String::new(),
            track_name: title.into(),
            artist_name: artist.into(),
            duration,
            instrumental: false,
            synced_lyrics: synced.then(|| "[00:01]test".into()),
            plain_lyrics: Some("test".into()),
        }
    }
    #[test]
    fn veezha_veera_search_accepts_unquoted_film_and_punctuation_variants() {
        let title = r#"Veezha Veera (From "OM Chapter 1: Udhiram - The Blood Wood") [Tamil]"#;
        let artists = "Sai Abhyankkar, Arun Srinivasan, Tippu";
        let mut row = record("Veezha Veera (From OM Chapter 1_ Udhiram - The Blood Wood) [Tamil]", artists, 236.0, true);
        row.id = Some(39483010);
        let records = vec![row.clone()];
        assert!(candidate(&records, title, artists, 238.0).is_some());
        assert!(matches!(result(row.clone(), 238.0), LyricResult::Synced { .. }));
        assert!(matches!(result(row, 248.0), LyricResult::Plain { .. }));
        assert!(candidate(&records, title, "Cover Singer", 238.0).is_none());
        let (base, server) = provider_http::tests::server(vec![
            ("404 Not Found", "{}".into()),
            ("200 OK", serde_json::json!([{"id":39483010,"trackName":records[0].track_name,"artistName":artists,"duration":236,"syncedLyrics":"[00:01]fixture"}]).to_string()),
        ]);
        let runtime = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        assert!(matches!(runtime.block_on(fetch_from(&base, title.into(), artists.into(), "OM Chapter 1: Udhiram - The Blood Wood".into(), 238.0)).unwrap(), LyricResult::Synced { .. }));
        let requests = server.join().unwrap();
        assert!(requests[1].contains("track_name=Veezha+Veera"));
        assert!(!requests[1].contains("Chapter"));
    }
    #[test]
    fn artist_extension_requires_complete_name_tokens_title_and_duration() {
        let records = vec![record("GUESS", "Emiway Bantai", 169.0, true)];
        assert!(candidate(&records, "GUESS", "Emiway", 169.0).is_some());
        assert!(candidate(&records, "GUESS", "Emiway", 190.0).is_none());
        assert!(candidate(&records, "GUESS", "Emi", 169.0).is_none());
        assert!(candidate(&records, "Other", "Emiway", 169.0).is_none());
        assert!(!artist_name_extension("Emiway Cover", "Emiway"));
    }

    #[test]
    fn guess_short_artist_name_uses_synced_search_result() {
        let (base, server) = provider_http::tests::server(vec![
            ("404 Not Found", "{}".into()),
            ("200 OK", r#"[{"id":6555308,"trackName":"GUESS","artistName":"Emiway Bantai","duration":169,"syncedLyrics":"[00:01]fixture"}]"#.into()),
        ]);
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        assert!(matches!(
            runtime
                .block_on(fetch_from(
                    &base,
                    "GUESS".into(),
                    "Emiway".into(),
                    "".into(),
                    169.0
                ))
                .unwrap(),
            LyricResult::Synced { .. }
        ));
        assert_eq!(server.join().unwrap().len(), 2);
    }
    #[test]
    fn search_rejects_wrong_artists_and_versions_but_accepts_video_intro_difference() {
        let records = vec![
            record("Snowman", "Cover artist", 173.0, true),
            record("Snowman", "Sia", 200.0, true),
            record("Snowman", "Sia", 166.0, true),
        ];
        assert_eq!(
            candidate(&records, "Snowman", "Sia", 173.0)
                .unwrap()
                .duration,
            166.0
        );
        assert!(candidate(&records, "Snowman", "", 173.0).is_some());
        assert!(candidate(&records, "Other song", "Sia", 173.0).is_none());
    }
    #[test]
    fn chooses_closest_recording_then_synced_lyrics() {
        let records = vec![
            record("Song", "Artist", 200.0, false),
            record("Song", "Artist", 200.0, true),
            record("Song", "Artist", 205.0, true),
        ];
        assert!(candidate(&records, "song", "artist", 200.0)
            .unwrap()
            .synced_lyrics
            .is_some());
    }
    #[test]
    fn unicode_titles_do_not_collapse_to_the_same_empty_string() {
        assert_ne!(lyric_identity::title("愛"), lyric_identity::title("雪"));
    }

    #[test]
    fn collaboration_and_film_titles_match_without_english_only_assumptions() {
        let records = vec![record(
            "Karuppa Kooda Va - From \"Karuppu\"",
            "Sai Abhyankkar, V.M. Mahalingam, Pa. Vijay",
            258.0,
            true,
        )];
        assert!(candidate(&records, "Karuppa Kooda Va", "Sai Abhyankkar", 258.0).is_some());
        let records = vec![record("Aarzu", "Noor", 188.0, true)];
        assert!(candidate(&records, "Aarzu", "Noor, Khan, Madhurxo", 188.0).is_some());
        assert!(matches!(
            result(
                candidate(&records, "Aarzu", "Noor, Khan, Madhurxo", 226.0)
                    .unwrap()
                    .clone(),
                226.0
            ),
            LyricResult::Plain { .. }
        ));
    }

    #[test]
    fn automatically_uses_the_nearest_native_edition_as_plain_text_for_different_audio() {
        let mut native = record("Aarzu", "Noor", 188.0, true);
        native.id = Some(1);
        native.synced_lyrics = Some("[00:01]पहली पंक्ति".into());
        let mut latin = record("Aarzu", "Noor", 188.0, true);
        latin.id = Some(2);
        let records = vec![latin, native];
        let best = candidate(&records, "Aarzu", "Noor, Khan", 226.0).unwrap();
        assert_eq!(best.id, Some(1));
        assert!(matches!(
            result(best.clone(), 226.0),
            LyricResult::Plain { .. }
        ));
    }

    #[test]
    fn unknown_artist_automatically_loads_title_and_duration_match() {
        let (base, server) = provider_http::tests::server(vec![("200 OK", r#"[{"id":1,"trackName":"கூட","artistName":"பாடகர்","duration":200,"syncedLyrics":"[00:01]முதல் வரி"}]"#.into())]);
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let result = runtime
            .block_on(fetch_from(
                &base,
                "கூட - From \"படம்\"".into(),
                "".into(),
                "".into(),
                200.0,
            ))
            .unwrap();
        assert!(matches!(result, LyricResult::Synced { .. }));
        let requests = server.join().unwrap();
        assert_eq!(requests.len(), 1);
        assert!(requests[0].starts_with("GET /search?"));
        assert!(!requests[0].contains("artist_name"));
    }

    #[test]
    #[ignore = "explicit multilingual live provider check; requires network"]
    fn live_multilingual_automatic_lyrics() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        runtime.block_on(async {
            let tamil = fetch(
                "Karuppa Kooda Va".into(),
                "Sai Abhyankkar".into(),
                "".into(),
                258.0,
            )
            .await
            .unwrap();
            assert!(matches!(tamil, LyricResult::Synced { .. }));
            let aarzu = fetch(
                "Aarzu".into(),
                "Noor, Khan, Madhurxo".into(),
                "".into(),
                226.0,
            )
            .await
            .unwrap();
            match aarzu {
                LyricResult::Plain { text, matched } => {
                    assert!(!text.contains("[00:"));
                    assert!(matched.is_some());
                }
                _ => panic!("Aarzu must load automatically as unsynced text for the longer video"),
            }
        });
    }

    #[test]
    fn exact_miss_uses_nearest_text_without_mislabeling_different_timing() {
        let (base, server) = provider_http::tests::server(vec![
            ("404 Not Found", "{}".into()),
            ("200 OK", r#"[{"trackName":"Snowman","artistName":"Sia","duration":166,"syncedLyrics":"[00:01]Original fixture","plainLyrics":null}]"#.into()),
        ]);
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let result = runtime
            .block_on(fetch_from(
                &base,
                "Snowman".into(),
                "Sia".into(),
                "YouTube".into(),
                173.0,
            ))
            .unwrap();
        assert!(matches!(result, LyricResult::Plain { .. }));
        let requests = server.join().unwrap();
        assert!(requests[0].starts_with("GET /get?"));
        assert!(!requests[0].contains("album_name"));
        assert!(requests[1].starts_with("GET /search?"));
        assert!(!requests[1].contains("duration="));
    }

    #[test]
    fn transient_exact_endpoint_overload_can_recover_through_search() {
        let (base, server) = provider_http::tests::server(vec![
            ("503 Service Unavailable", "{}".into()),
            ("503 Service Unavailable", "{}".into()),
            ("503 Service Unavailable", "{}".into()),
            ("200 OK", r#"[{"trackName":"Song","artistName":"Artist","duration":200,"syncedLyrics":"[00:01]Original fixture","plainLyrics":null}]"#.into()),
        ]);
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let result = runtime
            .block_on(fetch_from(
                &base,
                "Song".into(),
                "Artist".into(),
                "".into(),
                200.0,
            ))
            .unwrap();
        assert!(matches!(result, LyricResult::Synced { .. }));
        let requests = server.join().unwrap();
        assert_eq!(requests.len(), 4);
        assert!(requests[3].starts_with("GET /search?"));
    }

    #[test]
    fn prefers_synced_search_over_plain_exact_but_retains_plain_if_search_fails() {
        let plain = r#"{"trackName":"Song","artistName":"Artist","duration":200,"syncedLyrics":null,"plainLyrics":"Original fixture"}"#;
        for (status, search) in [
            (
                "200 OK",
                r#"[{"trackName":"Song","artistName":"Artist","duration":200,"syncedLyrics":"[00:01]Original fixture","plainLyrics":null}]"#,
            ),
            ("403 Forbidden", "{}"),
        ] {
            let (base, server) = provider_http::tests::server(vec![
                ("200 OK", plain.into()),
                (status, search.into()),
            ]);
            let runtime = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .unwrap();
            let result = runtime
                .block_on(fetch_from(
                    &base,
                    "Song".into(),
                    "Artist".into(),
                    "".into(),
                    200.0,
                ))
                .unwrap();
            if status == "200 OK" {
                assert!(matches!(result, LyricResult::Synced { .. }));
            } else {
                assert!(matches!(result, LyricResult::Plain { .. }));
            }
            assert_eq!(server.join().unwrap().len(), 2);
        }
    }

    #[test]
    fn wrong_duration_synced_hit_does_not_stop_search_for_compatible_timing() {
        let (base, server) = provider_http::tests::server(vec![
            ("200 OK", r#"{"trackName":"Song","artistName":"Artist","duration":200,"plainLyrics":"fixture"}"#.into()),
            ("200 OK", r#"[{"id":1,"trackName":"Song","artistName":"Artist","duration":230,"syncedLyrics":"[00:01]fixture"}]"#.into()),
            ("200 OK", r#"[{"id":2,"trackName":"Song","artistName":"Artist","duration":200,"syncedLyrics":"[00:01]fixture"}]"#.into()),
        ]);
        let runtime = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        let result = runtime.block_on(fetch_from(&base, "Song".into(), "Artist".into(), "".into(), 200.0)).unwrap();
        match result { LyricResult::Synced { matched: Some(info), .. } => assert_eq!(info.id, serde_json::json!(2)), _ => panic!("Expected compatible synchronized lyrics") }
        assert_eq!(server.join().unwrap().len(), 3);
    }

    #[test]
    #[ignore = "explicit live provider check; requires network"]
    fn live_snowman_native_lookup() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let result = runtime
            .block_on(fetch(
                "Snowman".into(),
                "Sia".into(),
                "YouTube".into(),
                173.0,
            ))
            .unwrap();
        assert!(matches!(result, LyricResult::Synced { .. }));
    }
}
