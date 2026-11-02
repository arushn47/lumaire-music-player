use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RecordingMetadata {
    pub source_id: String,
    #[serde(default)] pub isrcs: Vec<String>,
    pub release_date: Option<String>,
    #[serde(default)] pub artist_aliases: BTreeMap<String, Vec<String>>,
}

impl RecordingMetadata {
    pub fn valid(&self) -> bool {
        crate::catalog::valid_catalog_id(&self.source_id)
            && self.isrcs.len() <= 32 && self.isrcs.iter().all(|code| valid_isrc(code))
            && self.release_date.as_ref().is_none_or(|date| crate::music_metadata::date(date).as_ref() == Some(date))
            && self.artist_aliases.len() <= 32 && self.artist_aliases.iter().all(|(id, aliases)| {
                id.strip_prefix("musicbrainz:artist:").is_some_and(|id| uuid::Uuid::parse_str(id).is_ok_and(|parsed| parsed.to_string() == id))
                    && aliases.len() <= 32 && aliases.iter().all(|name| !name.trim().is_empty() && name.len() <= 1000 && !name.chars().any(char::is_control))
            })
    }
}
fn valid_isrc(code: &str) -> bool {
    let bytes = code.as_bytes();
    bytes.len() == 12 && bytes[..2].iter().all(u8::is_ascii_uppercase)
        && bytes[2..5].iter().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit()) && bytes[5..].iter().all(u8::is_ascii_digit)
}

pub fn from_provider(source_id: String, codes: &Value, date: Option<&str>, credits: &Value) -> Option<RecordingMetadata> {
    let mut isrcs: Vec<String> = codes.as_array().map(|codes| codes.iter().filter_map(Value::as_str).collect::<Vec<_>>()).unwrap_or_else(|| codes.as_str().into_iter().collect())
        .into_iter().map(|code| code.trim().replace('-', "").to_ascii_uppercase()).filter(|code| valid_isrc(code)).take(32).collect();
    isrcs.sort(); isrcs.dedup();
    let mut artist_aliases = BTreeMap::new();
    for credit in credits.as_array().into_iter().flatten().take(32) {
        let Some(id) = credit["artist"]["id"].as_str().filter(|id| uuid::Uuid::parse_str(id).is_ok_and(|parsed| parsed.to_string() == *id)) else { continue };
        let mut names: Vec<String> = credit["artist"]["aliases"].as_array().into_iter().flatten().filter_map(|alias| alias["name"].as_str())
            .chain(credit["artist"]["name"].as_str()).filter(|name| Some(*name) != credit["name"].as_str())
            .map(str::trim).filter(|name| !name.is_empty() && name.len() <= 1000 && !name.chars().any(char::is_control)).take(32).map(str::to_owned).collect();
        names.sort(); names.dedup();
        if !names.is_empty() { artist_aliases.insert(format!("musicbrainz:artist:{id}"), names); }
    }
    let value = RecordingMetadata { source_id, isrcs, release_date: date.and_then(crate::music_metadata::date), artist_aliases };
    (!value.isrcs.is_empty() || value.release_date.is_some() || !value.artist_aliases.is_empty()).then_some(value)
}

#[cfg(test)] mod tests {
    use super::*;
    #[test] fn validates_identifiers_dates_and_preserves_multilingual_aliases() {
        let credits = serde_json::json!([{"name":"Singer","artist":{"id":"46579862-aa41-4574-b16c-05e6d0b6dbeb","name":"गायक","aliases":[{"name":"பாடகர்"}]}}]);
        let value = from_provider("itunes:42".into(), &serde_json::json!(["us-abc-24-12345","bad", "USABC2412345"]), Some("2024-02-29"), &credits).unwrap();
        assert!(value.valid()); assert_eq!(value.isrcs, ["USABC2412345"]); assert_eq!(value.artist_aliases.values().next().unwrap().len(), 2);
        assert!(from_provider("itunes:42".into(), &Value::Null, Some("2023-02-29"), &Value::Null).is_none());
    }
}
