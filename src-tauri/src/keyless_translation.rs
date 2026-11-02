use crate::{translation::Line, Result};
use rusqlite::{params, Connection};
use serde_json::Value;
use std::{
    collections::HashMap,
    sync::Mutex,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::Manager;

const TRANSLATE: &str = "https://translate.google.com/translate_a/single";
const RECOVER: &str = "https://inputtools.google.com/request";

/// Minimum delay between batch translation requests to be respectful.
const BASE_DELAY: Duration = Duration::from_millis(350);
/// Maximum lines joined with \n in a single translation request.
const BATCH_SIZE: usize = 10;
/// Maximum consecutive 429 responses before stopping retries and honoring cooldown.
const MAX_CONSECUTIVE_429: u32 = 3;
/// Maximum retry attempts per batch.
const MAX_RETRIES: u32 = 3;

#[derive(Debug, serde::Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Processed {
    pub romanisation: HashMap<String, String>,
    pub translation: HashMap<String, String>,
    pub line_languages: HashMap<String, Vec<String>>,
    pub warnings: Vec<String>,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub incomplete: bool,
}

pub fn initialize(db: &Connection) -> Result<()> {
    db.execute_batch(
        "CREATE TABLE IF NOT EXISTS lyric_translations (
            source_text TEXT NOT NULL,
            source_lang TEXT NOT NULL,
            target_lang TEXT NOT NULL,
            translation TEXT NOT NULL,
            romanisation TEXT NOT NULL,
            detected_lang TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            PRIMARY KEY (source_text, source_lang, target_lang)
        );
        CREATE INDEX IF NOT EXISTS idx_lyric_translations_lookup
            ON lyric_translations(source_text, target_lang, source_lang);",
    )
    .map_err(crate::err)
}

fn normalize_key(text: &str) -> &str {
    text.trim()
}

pub fn load_cached(
    db: &Connection,
    texts: &[String],
    source_lang: &str,
    target_lang: &str,
) -> HashMap<String, (String, String, String)> {
    let mut cached = HashMap::new();
    let mut stmt = match db.prepare(
        "SELECT translation, romanisation, detected_lang 
         FROM lyric_translations 
         WHERE source_text = ?1 AND target_lang = ?2 AND (source_lang = ?3 OR ?3 = 'auto')
         ORDER BY CASE WHEN source_lang = ?3 THEN 0 ELSE 1 END LIMIT 1",
    ) {
        Ok(s) => s,
        Err(_) => return cached,
    };
    for text in texts {
        let key = normalize_key(text);
        if key.is_empty() {
            continue;
        }
        if let Ok(mut rows) = stmt.query(params![key, target_lang, source_lang]) {
            if let Ok(Some(row)) = rows.next() {
                if let (Ok(trans), Ok(roman), Ok(det)) = (
                    row.get::<_, String>(0),
                    row.get::<_, String>(1),
                    row.get::<_, String>(2),
                ) {
                    if !trans.trim().is_empty() {
                        cached.insert(text.clone(), (trans, roman, det));
                    }
                }
            }
        }
    }
    cached
}

pub fn save_cached(
    db: &Connection,
    items: &[(String, String, String, String)], // (source_text, translation, romanisation, detected_lang)
    source_lang: &str,
    target_lang: &str,
) {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    let mut stmt = match db.prepare_cached(
        "INSERT OR REPLACE INTO lyric_translations 
         (source_text, source_lang, target_lang, translation, romanisation, detected_lang, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
    ) {
        Ok(s) => s,
        Err(_) => return,
    };
    for (text, trans, roman, det) in items {
        let key = normalize_key(text);
        if !key.is_empty() && !trans.trim().is_empty() {
            let _ = stmt.execute(params![
                key,
                source_lang,
                target_lang,
                trans.trim(),
                roman.trim(),
                det.trim(),
                now
            ]);
        }
    }
}

fn supported(language: &str) -> bool {
    matches!(
        language,
        "auto"
            | "en"
            | "ta"
            | "ml"
            | "te"
            | "hi"
            | "bn"
            | "kn"
            | "mr"
            | "gu"
            | "pa"
            | "ja"
            | "ko"
            | "es"
            | "fr"
            | "de"
            | "pt"
            | "ar"
            | "zh-CN"
    )
}

fn same(left: &str, right: &str) -> bool {
    let normalize = |s: &str| {
        s.chars()
            .filter(|c| c.is_alphanumeric())
            .flat_map(char::to_lowercase)
            .collect::<String>()
    };
    normalize(left) == normalize(right)
}

fn latin(text: &str) -> bool {
    static NON_LATIN: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    !NON_LATIN
        .get_or_init(|| regex::Regex::new(r"[\p{L}&&\P{Latin}]").unwrap())
        .is_match(text)
}

#[derive(Debug)]
enum TranslateError {
    RateLimit { retry_after: Option<u64> },
    Server(String),
    Transient(String),
    MismatchedAlignment,
}

impl std::fmt::Display for TranslateError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::RateLimit { .. } => {
                write!(f, "Google translation is busy. Wait a little and retry.")
            }
            Self::Server(msg) | Self::Transient(msg) => write!(f, "{msg}"),
            Self::MismatchedAlignment => write!(f, "Translation alignment was uncertain."),
        }
    }
}

async fn read_json_checked(
    response: reqwest::Response,
) -> std::result::Result<Value, TranslateError> {
    if !response.status().is_success() {
        return Err(if response.status().as_u16() == 429 {
            let retry_after = response
                .headers()
                .get("retry-after")
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.parse::<u64>().ok());
            TranslateError::RateLimit { retry_after }
        } else if response.status().is_server_error() {
            TranslateError::Transient(format!(
                "Google translation returned HTTP {}. Retrying.",
                response.status().as_u16()
            ))
        } else {
            TranslateError::Server(format!(
                "Google translation is unavailable (HTTP {}). Retry later.",
                response.status().as_u16()
            ))
        });
    }
    let mut response = response;
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| TranslateError::Transient("Translation download failed. Retry.".into()))?
    {
        if bytes.len() + chunk.len() > 128 * 1024 {
            return Err(TranslateError::Server(
                "Translation response is too large.".into(),
            ));
        }
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes)
        .map_err(|_| TranslateError::Transient("Google returned an unreadable translation. Retry.".into()))
}

struct TranslatedBatch {
    segments: Vec<(String, String)>,
    language: String,
}

/// Parses and strictly verifies that the batch segments match the expected line count.
fn parse_batch_strict(body: &Value, expected_count: usize) -> std::result::Result<TranslatedBatch, TranslateError> {
    let parts = body[0]
        .as_array()
        .ok_or_else(|| TranslateError::Server("Google returned an invalid translation format.".into()))?;
    let language = body[2]
        .as_str()
        .filter(|s| s.len() <= 35 && s.bytes().all(|b| b.is_ascii_alphabetic() || b == b'-'))
        .ok_or_else(|| TranslateError::Server("Google did not identify the lyric language.".into()))?;

    let mut text = String::new();
    let mut roman = String::new();
    for part in parts {
        if let Some(value) = part[0].as_str() {
            text.push_str(value);
        }
        if let Some(value) = part[3].as_str() {
            roman.push_str(value);
        }
    }
    if text.trim().is_empty() || text.len() > 80_000 || roman.len() > 80_000 {
        return Err(TranslateError::Server("Google returned missing or oversized text.".into()));
    }

    let normalized_text = text.replace("\r\n", "\n");
    let normalized_roman = roman.replace("\r\n", "\n");

    let text_lines: Vec<&str> = normalized_text.split('\n').collect();
    let roman_lines: Vec<&str> = normalized_roman.split('\n').collect();

    if expected_count > 1 && text_lines.len() != expected_count {
        return Err(TranslateError::MismatchedAlignment);
    }

    let mut segments = Vec::with_capacity(expected_count);
    if expected_count == 1 {
        segments.push((normalized_text.trim().to_string(), normalized_roman.trim().to_string()));
    } else {
        for (i, t) in text_lines.into_iter().enumerate() {
            let r = roman_lines.get(i).copied().unwrap_or("").trim().to_string();
            segments.push((t.trim().to_string(), r));
        }
    }

    Ok(TranslatedBatch {
        segments,
        language: language.into(),
    })
}

fn translated_single(body: &Value) -> Result<(String, String, String)> {
    let batch = parse_batch_strict(body, 1).map_err(|e| e.to_string())?;
    let (text, roman) = batch.segments.into_iter().next().ok_or("Empty translation.")?;
    if text.trim().is_empty() || text.len() > 8000 || roman.len() > 8000 {
        return Err("Google returned missing or oversized text.".into());
    }
    Ok((text, roman, batch.language))
}

async fn translate_raw(
    client: &reqwest::Client,
    endpoint: &str,
    text: &str,
    language: &str,
) -> std::result::Result<Value, TranslateError> {
    let response = client
        .post(endpoint)
        .header("Accept", "application/json")
        .form(&[
            ("client", "at"),
            ("sl", language),
            ("tl", "en"),
            ("dt", "t"),
            ("q", text),
        ])
        .send()
        .await
        .map_err(|_| {
            TranslateError::Transient("Could not reach Google translation. Check your connection and retry.".into())
        })?;
    read_json_checked(response).await
}

fn rand_jitter(base_ms: u64) -> Duration {
    use std::sync::atomic::{AtomicU64, Ordering};
    static SEED: AtomicU64 = AtomicU64::new(0);
    let mut s = SEED.load(Ordering::Relaxed);
    if s == 0 {
        s = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos() as u64;
    }
    s ^= s << 13;
    s ^= s >> 7;
    s ^= s << 17;
    SEED.store(s, Ordering::Relaxed);
    let factor = 0.75 + ((s % 1000) as f64 / 2000.0);
    Duration::from_millis((base_ms as f64 * factor) as u64)
}

async fn translate_with_retry(
    client: &reqwest::Client,
    endpoint: &str,
    text: &str,
    language: &str,
    consecutive_429: &mut u32,
) -> std::result::Result<Value, TranslateError> {
    let mut last_error = None;
    for attempt in 0..MAX_RETRIES {
        if *consecutive_429 >= MAX_CONSECUTIVE_429 {
            return Err(TranslateError::RateLimit { retry_after: None });
        }
        if attempt > 0 {
            let base_ms = match &last_error {
                Some(TranslateError::RateLimit { retry_after: Some(secs) }) => {
                    (*secs * 1000).clamp(1000, 10_000)
                }
                Some(TranslateError::RateLimit { retry_after: None }) => 2000 << attempt.min(2),
                _ => 1000 << attempt.min(2),
            };
            tokio::time::sleep(rand_jitter(base_ms)).await;
        }
        match translate_raw(client, endpoint, text, language).await {
            Ok(body) => {
                *consecutive_429 = 0;
                return Ok(body);
            }
            Err(TranslateError::RateLimit { retry_after }) => {
                *consecutive_429 += 1;
                last_error = Some(TranslateError::RateLimit { retry_after });
            }
            Err(TranslateError::Transient(msg)) => {
                last_error = Some(TranslateError::Transient(msg));
            }
            Err(e) => return Err(e),
        }
    }
    Err(last_error.unwrap_or(TranslateError::Transient("Translation failed after retries.".into())))
}

async fn process_single_line(
    client: &reqwest::Client,
    endpoint: &str,
    recovery: &str,
    text: &str,
    language: &str,
    english_hint: bool,
    consecutive_429: &mut u32,
) -> std::result::Result<(String, String, String), TranslateError> {
    let sl = if english_hint { "auto" } else { language };
    let body = translate_with_retry(client, endpoint, text, sl, consecutive_429).await?;
    let direct = translated_single(&body).map_err(TranslateError::Server)?;
    if english_hint && direct.2 == "en" {
        return Ok(direct);
    }
    let source = if language == "auto" { direct.2.as_str() } else { language };
    if same(&direct.0, text)
        && latin(text)
        && matches!(
            source,
            "ta" | "ml" | "te" | "hi" | "bn" | "kn" | "mr" | "gu" | "pa" | "ja"
        )
    {
        let tool = format!("{source}-t-i0-und");
        let response = client
            .post(recovery)
            .header("Accept", "application/json")
            .form(&[
                ("text", text),
                ("itc", &tool),
                ("num", "1"),
                ("cp", "0"),
                ("cs", "1"),
                ("ie", "utf-8"),
                ("oe", "utf-8"),
            ])
            .send()
            .await
            .map_err(|_| TranslateError::Transient("Script recovery could not connect. Retry.".into()))?;
        let body = read_json_checked(response)
            .await
            .map_err(|e| TranslateError::Transient(format!("Script recovery: {e}")))?;
        if body[0] == "SUCCESS" {
            if let Some(native) = body[1][0][1][0]
                .as_str()
                .filter(|s| !s.is_ascii() && s.len() <= 8000)
            {
                tokio::time::sleep(BASE_DELAY).await;
                let recovered_body = translate_with_retry(client, endpoint, native, source, consecutive_429).await?;
                let recovered = translated_single(&recovered_body).map_err(TranslateError::Server)?;
                if same(&recovered.0, native) {
                    return Err(TranslateError::Server("Recovered script was not translated. Retry or try Gemini.".into()));
                }
                return Ok(recovered);
            }
        }
    }
    Ok(direct)
}

#[tauri::command]
pub async fn process_keyless_lyrics(
    app: tauri::AppHandle,
    lines: Vec<Line>,
    language: String,
) -> Result<Processed> {
    let db_state: Option<tauri::State<crate::Store>> = app.try_state();
    let db_ref = db_state.as_ref().map(|s| &s.0);
    process_from(lines, language, TRANSLATE, RECOVER, db_ref).await
}

pub async fn process_from(
    lines: Vec<Line>,
    language: String,
    endpoint: &str,
    recovery: &str,
    db: Option<&Mutex<Connection>>,
) -> Result<Processed> {
    let analysis = crate::lyric_languages::analyze(&lines)?;
    if !supported(&language) {
        return Err("Choose a supported source language.".into());
    }
    let mut result = Processed {
        line_languages: analysis.line_languages,
        ..Default::default()
    };
    if (analysis.english_only && language == "auto") || language == "en" {
        return Ok(result);
    }
    let client = reqwest::Client::builder()
        .http1_only()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
        .connect_timeout(Duration::from_secs(4))
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|_| "Could not start translation.")?;

    // Group identical lines together.
    let mut grouped: Vec<(String, Vec<String>, bool)> = Vec::new();
    for line in &lines {
        if !line.text.chars().any(char::is_alphabetic) {
            continue;
        }
        let english_hint = result.line_languages[&line.id] == ["eng"];
        if let Some((_, ids, _)) = grouped.iter_mut().find(|(text, _, _)| text == &line.text) {
            ids.push(line.id.clone());
        } else {
            grouped.push((line.text.clone(), vec![line.id.clone()], english_hint));
        }
    }

    let mut cache: HashMap<String, (String, String, String)> = HashMap::new();

    // 1. Load from persistent SQLite cache if available.
    if let Some(mutex) = db {
        if let Ok(conn) = mutex.lock() {
            let _ = initialize(&conn);
            let unique_texts: Vec<String> = grouped.iter().map(|(t, _, _)| t.clone()).collect();
            let from_sqlite = load_cached(&conn, &unique_texts, &language, "en");
            cache.extend(from_sqlite);
        }
    }

    let deadline = tokio::time::Instant::now() + Duration::from_secs(90);
    let mut failed = 0;
    let mut last_error = String::new();
    let mut consecutive_429: u32 = 0;
    let mut cooldown_hit = false;
    let mut newly_translated: Vec<(String, String, String, String)> = Vec::new();

    // Check which lines need recovery (Latin text with Indic language).
    let needs_recovery = |text: &str, english_hint: bool| -> bool {
        !english_hint
            && latin(text)
            && matches!(
                language.as_str(),
                "ta" | "ml" | "te" | "hi" | "bn" | "kn" | "mr" | "gu" | "pa" | "ja"
            )
    };

    let mut batchable: Vec<&(String, Vec<String>, bool)> = Vec::new();
    let mut recovery_needed: Vec<&(String, Vec<String>, bool)> = Vec::new();
    for entry in &grouped {
        if cache.contains_key(&entry.0) {
            continue; // Already resolved from persistent cache!
        }
        if needs_recovery(&entry.0, entry.2) {
            recovery_needed.push(entry);
        } else {
            batchable.push(entry);
        }
    }

    // Phase 1: Multi-line batch processing for batchable lines.
    for chunk in batchable.chunks(BATCH_SIZE) {
        if tokio::time::Instant::now() >= deadline || cooldown_hit {
            for entry in chunk {
                failed += entry.1.len();
            }
            if !cooldown_hit {
                last_error = "Time limit reached.".into();
            }
            continue;
        }

        let any_english = chunk.iter().any(|entry| entry.2);
        let sl = if any_english { "auto" } else { &language };
        let joined: String = chunk.iter().map(|entry| entry.0.as_str()).collect::<Vec<_>>().join("\n");

        match translate_with_retry(&client, endpoint, &joined, sl, &mut consecutive_429).await {
            Ok(body) => {
                // Strictly verify alignment.
                match parse_batch_strict(&body, chunk.len()) {
                    Ok(batch_result) => {
                        for (entry, (trans, roman)) in chunk.iter().zip(batch_result.segments.into_iter()) {
                            let item = (trans, roman, batch_result.language.clone());
                            cache.insert(entry.0.clone(), item.clone());
                            newly_translated.push((entry.0.clone(), item.0, item.1, item.2));
                        }
                    }
                    Err(TranslateError::MismatchedAlignment) => {
                        // Alignment was uncertain: reject batch and fall back to single-line requests.
                        // NEVER split batches into individual requests after HTTP 429; here we got 200 OK.
                        for entry in chunk {
                            if tokio::time::Instant::now() >= deadline || cooldown_hit {
                                failed += entry.1.len();
                                break;
                            }
                            tokio::time::sleep(BASE_DELAY).await;
                            match process_single_line(
                                &client,
                                endpoint,
                                recovery,
                                &entry.0,
                                &language,
                                entry.2,
                                &mut consecutive_429,
                            )
                            .await
                            {
                                Ok(value) => {
                                    cache.insert(entry.0.clone(), value.clone());
                                    newly_translated.push((entry.0.clone(), value.0, value.1, value.2));
                                }
                                Err(TranslateError::RateLimit { .. }) => {
                                    cooldown_hit = true;
                                    failed += entry.1.len();
                                    last_error = "Google translation rate limit reached. Wait a little and retry.".into();
                                    break;
                                }
                                Err(e) => {
                                    failed += entry.1.len();
                                    last_error = e.to_string();
                                }
                            }
                        }
                    }
                    Err(e) => {
                        for entry in chunk {
                            failed += entry.1.len();
                        }
                        last_error = e.to_string();
                    }
                }
            }
            Err(TranslateError::RateLimit { .. }) => {
                cooldown_hit = true;
                for entry in chunk {
                    failed += entry.1.len();
                }
                last_error = "Google translation rate limit reached. Wait a little and retry.".into();
            }
            Err(e) => {
                for entry in chunk {
                    failed += entry.1.len();
                }
                last_error = e.to_string();
            }
        }

        if !cooldown_hit {
            tokio::time::sleep(BASE_DELAY).await;
        }
    }

    // Phase 2: Sequential single-line processing for recovery-needed lines.
    for entry in recovery_needed {
        if tokio::time::Instant::now() >= deadline || cooldown_hit {
            failed += entry.1.len();
            if !cooldown_hit {
                last_error = "Time limit reached.".into();
            }
            continue;
        }

        match process_single_line(
            &client,
            endpoint,
            recovery,
            &entry.0,
            &language,
            entry.2,
            &mut consecutive_429,
        )
        .await
        {
            Ok(value) => {
                cache.insert(entry.0.clone(), value.clone());
                newly_translated.push((entry.0.clone(), value.0, value.1, value.2));
            }
            Err(TranslateError::RateLimit { .. }) => {
                cooldown_hit = true;
                failed += entry.1.len();
                last_error = "Google translation rate limit reached. Wait a little and retry.".into();
            }
            Err(e) => {
                failed += entry.1.len();
                last_error = e.to_string();
            }
        }

        if !cooldown_hit {
            tokio::time::sleep(BASE_DELAY).await;
        }
    }

    // Save newly translated results to persistent SQLite cache.
    if let Some(mutex) = db {
        if !newly_translated.is_empty() {
            if let Ok(conn) = mutex.lock() {
                save_cached(&conn, &newly_translated, &language, "en");
            }
        }
    }

    // Apply translations from cache to results.
    for (text, ids, _) in &grouped {
        if let Some((translation, roman, detected)) = cache.get(text) {
            let unchanged = same(translation, text);
            if unchanged {
                failed += ids
                    .iter()
                    .filter(|id| result.line_languages[*id] != ["eng"])
                    .count();
                continue;
            }
            for id in ids {
                result.translation.insert(id.clone(), translation.clone());
                if !text.is_ascii()
                    && !roman.trim().is_empty()
                    && roman.chars().all(|c| {
                        !c.is_alphabetic()
                            || c.is_ascii()
                            || ('\u{00c0}'..='\u{024f}').contains(&c)
                    })
                {
                    result.romanisation.insert(id.clone(), roman.clone());
                }
                result
                    .line_languages
                    .insert(id.clone(), vec![detected.clone()]);
            }
        }
    }

    if failed > 0 {
        result.incomplete = true;
        let saved = result.translation.len();
        if cooldown_hit {
            result.warnings.push(format!(
                "{failed} lines could not be translated ({saved} saved). Google translation rate limit reached. Wait a little and retry the remaining lines."
            ));
        } else {
            result.warnings.push(format!(
                "{failed} lines could not be translated. Choose the source language for romanized lyrics, retry, or try Gemini. {last_error}"
            ));
        }
    }

    if result.translation.is_empty() && failed > 0 {
        return Err(result.warnings.join(" "));
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::provider_http::tests::server;

    fn lines(texts: &[&str]) -> Vec<Line> {
        texts
            .iter()
            .enumerate()
            .map(|(i, text)| Line {
                id: format!("line-{i}"),
                text: text.to_string(),
            })
            .collect()
    }

    fn body(text: &str, lang: &str) -> String {
        serde_json::json!([[[text, "original", null, null]], null, lang]).to_string()
    }

    fn batch_body(texts: &[&str], lang: &str) -> String {
        let joined = texts.join("\n");
        serde_json::json!([[[joined, "original", null, null]], null, lang]).to_string()
    }

    fn run(lines: Vec<Line>, language: &str, endpoint: &str) -> Result<Processed> {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(process_from(lines, language.into(), endpoint, endpoint, None))
    }

    fn run_with_db(
        lines: Vec<Line>,
        language: &str,
        endpoint: &str,
        db: &Mutex<Connection>,
    ) -> Result<Processed> {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(process_from(lines, language.into(), endpoint, endpoint, Some(db)))
    }

    #[test]
    fn validates_and_skips_english_without_network() {
        assert!(latin("naalai mazhai — nān"));
        assert!(!latin("நாளை"));
        assert!(run(
            lines(&["I will always be here when you need me"]),
            "auto",
            "invalid"
        )
        .unwrap()
        .translation
        .is_empty());
        assert!(run(lines(&["தமிழ்"]), "https://evil.test", "invalid").is_err());
        assert!(run(
            lines(&["தமிழ்"])
                .into_iter()
                .chain(lines(&["more"]))
                .collect(),
            "auto",
            "invalid"
        )
        .is_err());
        assert!(translated_single(&serde_json::json!({})).is_err());
        assert!(translated_single(&serde_json::json!([[["", null]], null, "ta"])).is_err());
    }

    #[test]
    fn english_hint_does_not_discard_a_different_translation() {
        let (url, server) = server(vec![(
            "200 OK",
            body("A different translated sentence", "hi"),
        )]);
        let output = run(
            lines(&["I will always be here when you need me"]),
            "hi",
            &url,
        )
        .unwrap();
        assert_eq!(
            output.translation["line-0"],
            "A different translated sentence"
        );
        assert!(server.join().unwrap()[0].contains("sl=auto"));
    }

    #[test]
    fn recovers_script_deduplicates_and_preserves_ids() {
        let text = "naalai mazhai vanthaalum naan unnudan nadappen";
        let (url, server) = server(vec![
            ("200 OK", body(text, "ta")),
            (
                "200 OK",
                serde_json::json!(["SUCCESS", [[text, ["நாளை மழை வந்தாலும் நான் உன்னுடன் நடப்பேன்"]]]])
                    .to_string(),
            ),
            (
                "200 OK",
                body("Even if it rains tomorrow I will walk with you", "ta"),
            ),
        ]);
        let output = run(lines(&[text, text]), "ta", &url).unwrap();
        assert_eq!(output.translation.len(), 2);
        assert_eq!(output.translation["line-0"], output.translation["line-1"]);
        assert!(output.warnings.is_empty());
        let requests = server.join().unwrap();
        assert_eq!(requests.len(), 3);
        assert!(requests[0].contains("sl=ta"));
        assert!(requests[1].contains("itc=ta-t-i0-und"));
    }

    #[test]
    fn rate_limit_429_stops_without_splitting_and_shows_cooldown() {
        let (url, server) = server(vec![
            ("429 Too Many Requests", "{}".into()),
            ("429 Too Many Requests", "{}".into()),
            ("429 Too Many Requests", "{}".into()),
        ]);
        let error = run(lines(&["தமிழ் ஒன்று", "தமிழ் இரண்டு"]), "ta", &url).unwrap_err();
        assert!(error.contains("rate limit"), "expected rate limit error, got: {error}");
        let requests = server.join().unwrap();
        // Should stop after MAX_RETRIES (3 attempts), never splitting into individual requests.
        assert_eq!(requests.len(), 3, "Expected 3 attempts before stopping, got {}", requests.len());
    }

    #[test]
    fn newline_mismatch_rejects_batch_and_uses_single_line_fallback() {
        let (url, server) = server(vec![
            // Batch returns only 1 segment for 2 lines (newline mismatch / uncertain alignment).
            ("200 OK", body("Single merged translation", "ta")),
            // Safe single-line fallback:
            ("200 OK", body("First translation", "ta")),
            ("200 OK", body("Second translation", "ta")),
        ]);
        let output = run(lines(&["தமிழ் ஒன்று", "தமிழ் இரண்டு"]), "ta", &url).unwrap();
        assert_eq!(output.translation.len(), 2);
        assert_eq!(output.translation["line-0"], "First translation");
        assert_eq!(output.translation["line-1"], "Second translation");
        let requests = server.join().unwrap();
        assert_eq!(requests.len(), 3);
    }

    #[test]
    fn malformed_batch_response_handled_gracefully() {
        let (url, server) = server(vec![
            ("200 OK", "not valid json".into()),
            ("200 OK", "not valid json".into()),
            ("200 OK", "not valid json".into()),
        ]);
        let result = run(lines(&["தமிழ் ஒன்று"]), "ta", &url);
        assert!(result.is_err());
        server.join().unwrap();
    }

    #[test]
    fn partial_success_is_preserved_with_incomplete_flag() {
        // 12 lines total with BATCH_SIZE=10: Batch 1 has 10 lines, Batch 2 has 2 lines.
        let texts: Vec<String> = (0..12).map(|i| format!("தமிழ் வரி {i}")).collect();
        let text_refs: Vec<&str> = texts.iter().map(|s| s.as_str()).collect();

        // 10 lines for batch 1:
        let batch1_trans: Vec<&str> = (0..10).map(|_| "Translated line").collect();
        let (url, server) = server(vec![
            ("200 OK", batch_body(&batch1_trans, "ta")),
            ("429 Too Many Requests", "{}".into()),
            ("429 Too Many Requests", "{}".into()),
            ("429 Too Many Requests", "{}".into()),
        ]);

        let output = run(lines(&text_refs), "ta", &url).unwrap();
        // 10 lines saved, 2 failed.
        assert_eq!(output.translation.len(), 10);
        assert!(output.incomplete, "incomplete flag must be true on partial success");
        assert!(output.warnings.iter().any(|w| w.contains("saved") && w.contains("rate limit")));
        server.join().unwrap();
    }

    #[test]
    fn persistent_cache_reuses_saved_translations_without_network() {
        let db = Mutex::new(Connection::open_in_memory().unwrap());

        // First run: translates via network and saves to SQLite.
        let (url, server) = server(vec![
            ("200 OK", batch_body(&["First translated", "Second translated"], "ta")),
        ]);
        let input = lines(&["தமிழ் ஒன்று", "தமிழ் இரண்டு"]);
        let out1 = run_with_db(input.clone(), "ta", &url, &db).unwrap();
        assert_eq!(out1.translation.len(), 2);
        assert_eq!(server.join().unwrap().len(), 1);

        // Second run with invalid URL: must succeed purely from SQLite cache with 0 network requests!
        let out2 = run_with_db(input, "ta", "http://invalid-must-not-be-reached.test", &db).unwrap();
        assert_eq!(out2.translation.len(), 2);
        assert_eq!(out2.translation["line-0"], "First translated");
        assert_eq!(out2.translation["line-1"], "Second translated");
        assert!(!out2.incomplete);
    }
}
