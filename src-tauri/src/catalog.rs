//! Public music metadata only; playback remains a separate source resolution.
use crate::{
    itunes_metadata::{self, CatalogTrack},
    provider_http,
};
use serde_json::Value;
use std::collections::HashSet;

const BASE: &str = "https://www.jiosaavn.com/api.php";

pub(crate) fn valid_catalog_id(id: &str) -> bool {
    id.strip_prefix("saavn:").is_some_and(valid_id)
        || id.strip_prefix("itunes:").is_some_and(|value| {
            value
                .parse::<u64>()
                .is_ok_and(|n| n > 0 && value == n.to_string())
        })
        || id
            .strip_prefix("musicbrainz:recording:")
            .is_some_and(|value| {
                uuid::Uuid::parse_str(value).is_ok_and(|id| id.to_string() == value)
            })
}

fn valid_id(id: &str) -> bool {
    id.len() == 8
        && id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
}

fn text(value: &str) -> String {
    let mut decoded = value.to_string();
    for (entity, replacement) in [
        ("&quot;", "\""),
        ("&#039;", "'"),
        ("&#39;", "'"),
        ("&#x27;", "'"),
        ("&apos;", "'"),
        ("&lt;", "<"),
        ("&gt;", ">"),
        ("&nbsp;", " "),
        ("&amp;", "&"),
    ] {
        decoded = decoded.replace(entity, replacement);
    }
    decoded.trim().to_string()
}

fn name(value: &Value) -> Option<String> {
    let value = text(value.as_str()?);
    (!value.is_empty() && value.chars().count() <= 4000 && !value.chars().any(char::is_control))
        .then_some(value)
}

fn entity_id(value: &Value) -> Option<String> {
    let id = value
        .as_str()
        .map(str::to_owned)
        .or_else(|| value.as_u64().map(|id| id.to_string()))?;
    let number = id.parse::<u64>().ok().filter(|id| *id > 0)?;
    (id == number.to_string()).then_some(id)
}

fn artwork(value: &Value) -> Option<String> {
    let url = reqwest::Url::parse(value.as_str()?).ok()?;
    (url.scheme() == "https"
        && url.host_str() == Some("c.saavncdn.com")
        && url.username().is_empty()
        && url.password().is_none()
        && url.port_or_known_default() == Some(443))
    .then(|| url.as_str().replace("150x150", "500x500"))
}

pub(crate) fn artist_names(value: &str) -> Vec<String> {
    let mut names = crate::lyric_identity::credits(value);
    if names.len() > 1 {
        names.remove(0);
    }
    names
}

fn credits(value: &Value) -> Vec<itunes_metadata::CatalogArtistCredit> {
    let mut seen = HashSet::new();
    ["primary_artists", "featured_artists"]
        .iter()
        .flat_map(|key| value[key].as_array().into_iter().flatten())
        .filter_map(|artist| {
            Some(itunes_metadata::CatalogArtistCredit {
                name: name(&artist["name"])?,
                id: entity_id(&artist["id"]).map(|id| format!("saavn:artist:{id}")),
            })
        })
        .filter(|credit| seen.insert((credit.id.clone(), credit.name.clone())))
        .collect()
}

pub(crate) fn valid_artist_id(id: &str) -> bool {
    id.strip_prefix("saavn:artist:")
        .or_else(|| id.strip_prefix("itunes:"))
        .is_some_and(|source| entity_id(&Value::String(source.into())).is_some())
        || id
            .strip_prefix("musicbrainz:artist:")
            .is_some_and(|source| {
                uuid::Uuid::parse_str(source).is_ok_and(|id| id.to_string() == source)
            })
}

pub(crate) fn same_name(left: &str, right: &str) -> bool {
    left.trim().to_lowercase() == right.trim().to_lowercase()
}

fn track(value: &Value) -> Option<CatalogTrack> {
    if value["type"].as_str()? != "song" {
        return None;
    }
    let id = value["id"].as_str().filter(|id| valid_id(id))?;
    let title = name(&value["title"])?;
    let info = &value["more_info"];
    let duration = info["duration"]
        .as_str()?
        .parse::<u32>()
        .ok()
        .filter(|seconds| (1..=86400).contains(seconds))?;
    let artists_credits = credits(&info["artistMap"]);

    if artists_credits.is_empty() {
        return None;
    }

    let artist_names: Vec<String> = artists_credits.iter().map(|a| a.name.clone()).collect();
    let artist_id = artists_credits.first().and_then(|a| a.id.clone());

    let album_id = entity_id(&info["album_id"]).map(|id| format!("saavn:album:{id}"));
    let artwork_url = artwork(&value["image"]);
    Some(CatalogTrack {
        recording_metadata: crate::recording_metadata::from_provider(
            format!("saavn:{id}"),
            &info["isrc"],
            value["release_date"]
                .as_str()
                .or_else(|| info["release_date"].as_str()),
            &serde_json::Value::Null,
        ),
        play_count: info["play_count"]
            .as_u64()
            .or_else(|| info["play_count"].as_str()?.parse().ok())
            .or_else(|| value["play_count"].as_u64())
            .or_else(|| value["play_count"].as_str()?.parse().ok())
            .filter(|count| *count > 0),
        genre: name(&info["genre"]).or_else(|| name(&info["primary_genre_name"])),
        language: name(&value["language"]).or_else(|| name(&info["language"])),
        id: format!("saavn:{id}"),
        title,
        artist: artist_names.join(", "),
        artist_id,
        artists: artists_credits,
        album: info["album"].as_str().map(text).unwrap_or_default(),
        album_id,
        duration: duration as f64,
        artwork_url,
    })
}

async fn request(base: &str, operation: &str, params: &[(&str, String)]) -> Result<Value, String> {
    request_context(base, operation, params, "web6dot0").await
}

async fn request_context(
    base: &str,
    operation: &str,
    params: &[(&str, String)],
    context: &str,
) -> Result<Value, String> {
    request_context_cookie(base, operation, params, context, "").await
}

async fn request_context_cookie(
    base: &str,
    operation: &str,
    params: &[(&str, String)],
    context: &str,
    cookie: &str,
) -> Result<Value, String> {
    // shortcut: public metadata endpoints are undocumented; revisit if their response shape changes.
    let mut query = vec![
        ("__call", operation.into()),
        ("_format", "json".into()),
        ("_marker", "0".into()),
        ("api_version", "4".into()),
        ("ctx", context.into()),
    ];
    query.extend_from_slice(params);
    let response = provider_http::get_with_cookie(base, &query, cookie).await?;
    if !response.status().is_success() {
        return Err(format!(
            "Music catalog is unavailable (HTTP {}).",
            response.status()
        ));
    }
    response
        .json()
        .await
        .map_err(|_| "Invalid music catalog response.".into())
}

pub(crate) async fn search_from(
    base: &str,
    query: &str,
    limit: u32,
) -> Result<Vec<CatalogTrack>, String> {
    let response = request(
        base,
        "search.getResults",
        &[
            ("q", query.into()),
            ("n", limit.to_string()),
            ("p", "1".into()),
        ],
    )
    .await?;
    let rows = response["results"]
        .as_array()
        .ok_or("Invalid music catalog response.")?;
    let mut seen = HashSet::new();
    Ok(rows
        .iter()
        .filter_map(track)
        .filter(|track| seen.insert(track.id.clone()))
        .take(limit as usize)
        .collect())
}

#[tauri::command]
pub async fn search_catalog_records(
    query: String,
    limit: Option<u32>,
) -> Result<Vec<CatalogTrack>, String> {
    let query = query.trim();
    if !(1..=200).contains(&query.chars().count()) || query.chars().any(char::is_control) {
        return Err("Enter a catalog search between 1 and 200 characters.".into());
    }
    crate::catalog_search::search_records(query, limit.unwrap_or(60).clamp(1, 60) as usize).await
}

#[tauri::command]
pub async fn search_catalog(
    query: String,
    limit: Option<u32>,
) -> Result<Vec<CatalogTrack>, String> {
    let query = query.trim();
    if !(1..=200).contains(&query.chars().count()) || query.chars().any(char::is_control) {
        return Err("Enter a catalog search between 1 and 200 characters.".into());
    }
    let limit = limit.unwrap_or(20).clamp(1, 30);
    crate::catalog_search::search(query, limit as usize).await
}

async fn lookup_from(base: &str, id: &str) -> Result<CatalogTrack, String> {
    let source = id
        .strip_prefix("saavn:")
        .filter(|id| valid_id(id))
        .ok_or("Invalid music catalog track ID.")?;
    let response = request(base, "song.getDetails", &[("pids", source.into())]).await?;
    response["songs"]
        .as_array()
        .ok_or("Invalid music catalog response.")?
        .iter()
        .filter_map(track)
        .find(|track| track.id == id)
        .ok_or_else(|| "This music catalog track is unavailable.".into())
}

#[tauri::command]
pub async fn lookup_catalog(id: String) -> Result<CatalogTrack, String> {
    if id.starts_with("musicbrainz:recording:") {
        return crate::brainz_catalog::lookup(&id).await;
    }
    if id.starts_with("itunes:") {
        return itunes_metadata::lookup_catalog(id).await;
    }
    lookup_from(BASE, &id).await
}

fn radio_tracks(response: &Value) -> Vec<CatalogTrack> {
    let mut seen = HashSet::new();
    // Numeric station positions carry the provider's radio ranking; metadata fields do not.
    (0..30)
        .filter_map(|i| {
            let row = &response[i.to_string()]["song"];
            track(row)
        })
        .filter(|song| seen.insert(song.id.clone()))
        .collect()
}

async fn recommendations_from(base: &str, id: &str) -> Result<Vec<CatalogTrack>, String> {
    let source = id
        .strip_prefix("saavn:")
        .filter(|id| valid_id(id))
        .ok_or("Invalid radio seed track ID.")?;
    let details = request(base, "song.getDetails", &[("pids", source.into())]).await?;
    details["songs"]
        .as_array()
        .and_then(|rows| {
            rows.iter()
                .find(|row| row["id"].as_str() == Some(source) && track(row).is_some())
        })
        .ok_or("This radio seed is unavailable.")?;
    let station = request_context(
        base,
        "webradio.createEntityStation",
        &[
            ("entity_id", serde_json::json!([source]).to_string()),
            ("entity_type", "queue".into()),
        ],
        "android",
    )
    .await?;
    let station_id = station["stationid"]
        .as_str()
        .filter(|value| {
            !value.is_empty() && value.len() <= 512 && !value.chars().any(char::is_control)
        })
        .ok_or("Song radio is temporarily unavailable.")?;
    let response = request_context(
        base,
        "webradio.getSong",
        &[("stationid", station_id.into()), ("k", "30".into())],
        "android",
    )
    .await?;
    Ok(radio_tracks(&response))
}

#[tauri::command]
pub async fn recommend_catalog(id: String) -> Result<Vec<CatalogTrack>, String> {
    if id.starts_with("saavn:") {
        return recommendations_from(BASE, &id).await;
    }
    // Apple IDs must be matched to the same song before using the radio provider.
    let seed = lookup_catalog(id).await?;
    let query = format!(
        "{} {}",
        crate::lyric_identity::query_title(&seed.title),
        crate::lyric_identity::primary_artist(&seed.artist)
    );
    let matched = search_from(BASE, &query.chars().take(200).collect::<String>(), 10)
        .await?
        .into_iter()
        .find(|song| {
            crate::lyric_identity::title(&song.title) == crate::lyric_identity::title(&seed.title)
                && crate::lyric_identity::artists_match(&song.artist, &seed.artist)
        })
        .ok_or("No matching song radio was found.")?;
    recommendations_from(BASE, &matched.id).await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn recording_identifiers_propagate_without_changing_catalogue_identity() {
        let mut row = song();
        row["more_info"]["isrc"] = "INABC2312345".into();
        row["release_date"] = "2023-08-10".into();
        let parsed = track(&row).unwrap();
        let details = parsed.recording_metadata.unwrap();
        assert_eq!(parsed.id, "saavn:QAbmbZ7O");
        assert_eq!(details.source_id, parsed.id);
        assert_eq!(details.isrcs, ["INABC2312345"]);
        assert_eq!(details.release_date.as_deref(), Some("2023-08-10"));
    }
    fn song() -> Value {
        serde_json::json!({"id":"QAbmbZ7O","type":"song","title":"Sensitive &amp; &#039;Sure&#039;",
        "image":"https://c.saavncdn.com/517/album-150x150.jpg", "more_info":{
            "duration":"224", "album":"Yours &quot;Truly&quot;", "artistMap":{"primary_artists":[{"name":"KR$NA"},{"name":"Seedhe Maut"},{"name":"Hurricane"}]}
        }})
    }
    #[test]
    fn entity_search_preserves_joint_provider_identity() {
        let (base, server) = provider_http::tests::server(vec![
            ("200 OK", serde_json::json!({"results":[{"id":"42","name":"Hasan Raheem, Abdullah and Talal Qureshi","type":"artist"}]}).to_string()),
            ("200 OK", serde_json::json!({"results":[]}).to_string()),
        ]);
        let result = runtime()
            .block_on(search_entities_from(&base, "Hasan Raheem"))
            .unwrap();
        assert_eq!(result.artists.len(), 1);
        assert_eq!(
            result.artists[0].name,
            "Hasan Raheem, Abdullah and Talal Qureshi"
        );
        assert_eq!(result.artists[0].id, "saavn:artist:42");
        assert_eq!(server.join().unwrap().len(), 2);
    }
    #[test]
    fn structured_credits_preserve_joint_provider_identity() {
        let value = serde_json::json!({"primary_artists":[{"id":"42","name":"Hasan Raheem, Abdullah and Talal Qureshi"}]});
        let credits = credits(&value);
        assert_eq!(
            credits
                .iter()
                .map(|credit| credit.name.as_str())
                .collect::<Vec<_>>(),
            ["Hasan Raheem, Abdullah and Talal Qureshi"]
        );
        assert_eq!(credits[0].id.as_deref(), Some("saavn:artist:42"));
    }
    #[test]
    fn song_radio_preserves_languages_and_validated_metadata_in_provider_order() {
        let mut seed = song();
        seed["language"] = "urdu".into();
        let mut same = seed.clone();
        same["id"] = "abcdefgh".into();
        let mut other = seed.clone();
        other["id"] = "ijklmnop".into();
        other["language"] = "english".into();
        let response = serde_json::json!({"0":{"song":same},"1":{"song":other},"2":{"song":same},"3":{"song":{"id":"bad"}},"stationid":"temporary"});
        assert_eq!(
            radio_tracks(&response)
                .iter()
                .map(|row| row.id.as_str())
                .collect::<Vec<_>>(),
            vec!["saavn:abcdefgh", "saavn:ijklmnop"]
        );
        let (base, server) = crate::provider_http::tests::server(vec![
            ("200 OK", serde_json::json!({"songs":[seed]}).to_string()),
            (
                "200 OK",
                serde_json::json!({"stationid":"temporary"}).to_string(),
            ),
            ("200 OK", response.to_string()),
        ]);
        let songs = runtime()
            .block_on(recommendations_from(&base, "saavn:QAbmbZ7O"))
            .unwrap();
        assert_eq!(songs.len(), 2);
        let requests = server.join().unwrap();
        assert!(
            requests[1].contains("webradio.createEntityStation")
                && requests[1].contains("ctx=android")
        );
        assert!(
            requests[2].contains("webradio.getSong") && requests[2].contains("stationid=temporary")
        );
        assert!(runtime()
            .block_on(recommendations_from(&base, "saavn:bad"))
            .is_err());
    }
    fn runtime() -> tokio::runtime::Runtime {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
    }
    #[test]
    fn catalog_metadata_preserves_credits_and_decodes_entities_without_media() {
        let mut value = song();
        value["language"] = "tamil".into();
        value["more_info"]["genre"] = "Film".into();
        let catalog = track(&value).unwrap();
        assert_eq!(catalog.language.as_deref(), Some("tamil"));
        assert_eq!(catalog.genre.as_deref(), Some("Film"));
        value["language"] = "bad\nmetadata".into();
        assert!(track(&value).unwrap().language.is_none());
        assert_eq!(catalog.id, "saavn:QAbmbZ7O");
        assert_eq!(catalog.title, "Sensitive & 'Sure'");
        assert_eq!(catalog.artist, "KR$NA, Seedhe Maut, Hurricane");
        assert_eq!(catalog.album, "Yours \"Truly\"");
        assert_eq!(catalog.duration, 224.0);
        assert_eq!(
            catalog.artwork_url.as_deref(),
            Some("https://c.saavncdn.com/517/album-500x500.jpg")
        );
        // Verify artist and album IDs are extracted when present
        let mut full_song = song();
        full_song["more_info"]["artistMap"]["primary_artists"][0]["id"] =
            serde_json::json!("123456");
        full_song["more_info"]["album_id"] = serde_json::json!("789012");
        let full_catalog = track(&full_song).unwrap();
        assert_eq!(
            full_catalog.artist_id.as_deref(),
            Some("saavn:artist:123456")
        );
        assert_eq!(full_catalog.album_id.as_deref(), Some("saavn:album:789012"));

        for id in ["", "short", "QAbmbZ7O?", "QAbmbZ7/", "１２３４５６７８"] {
            assert!(!valid_id(id));
        }
        for (key, value) in [
            ("id", serde_json::json!(42)),
            ("type", serde_json::json!("album")),
            ("title", serde_json::json!(" ")),
        ] {
            let mut row = song();
            row[key] = value;
            assert!(track(&row).is_none());
        }
        for value in [
            serde_json::json!(0),
            serde_json::json!("0"),
            serde_json::json!("86401"),
            serde_json::json!("NaN"),
            Value::Null,
        ] {
            let mut row = song();
            row["more_info"]["duration"] = value;
            assert!(track(&row).is_none());
        }
        let mut row = song();
        row["more_info"]["artistMap"]["primary_artists"] = serde_json::json!([]);
        assert!(track(&row).is_none());
        for url in [
            "http://c.saavncdn.com/a",
            "https://c.saavncdn.com.evil.test/a",
            "https://user@c.saavncdn.com/a",
            "https://c.saavncdn.com:444/a",
        ] {
            let mut row = song();
            row["image"] = url.into();
            assert!(track(&row).unwrap().artwork_url.is_none());
        }
    }
    #[test]
    fn actual_catalog_search_validates_deduplicates_and_bounds_one_list() {
        let response = serde_json::json!({"results":[song(), song(), {"id":"bad"}]}).to_string();
        let (base, server) = provider_http::tests::server(vec![("200 OK", response)]);
        let tracks = runtime()
            .block_on(search_from(&base, "Sensitive KR$NA", 20))
            .unwrap();
        assert_eq!(tracks.len(), 1);
        let requests = server.join().unwrap();
        assert_eq!(requests.len(), 1);
        assert!(requests[0].contains("__call=search.getResults"));
        assert!(requests[0].contains("q=Sensitive+KR%24NA"));
        assert!(requests[0].contains("n=20"));
    }
    #[test]
    fn exact_lookup_uses_only_selected_id_and_rejects_replacements() {
        let runtime = runtime();
        for (returned, success) in [("QAbmbZ7O", true), ("other123", false)] {
            let mut row = song();
            row["id"] = returned.into();
            let (base, server) = provider_http::tests::server(vec![(
                "200 OK",
                serde_json::json!({"songs":[row]}).to_string(),
            )]);
            let result = runtime.block_on(lookup_from(&base, "saavn:QAbmbZ7O"));
            assert_eq!(result.is_ok(), success);
            let requests = server.join().unwrap();
            assert!(requests[0].contains("pids=QAbmbZ7O"));
            assert!(requests[0].contains("__call=song.getDetails"));
            assert!(!requests[0].contains("q="));
        }
        assert!(runtime
            .block_on(lookup_from("invalid", "saavn:../file"))
            .is_err());
    }
    #[test]
    fn catalog_inputs_and_provider_failures_remain_errors() {
        let runtime = runtime();
        for query in ["".to_string(), "a".repeat(201), "a\nb".to_string()] {
            assert!(runtime.block_on(search_catalog(query, None)).is_err());
        }
        for (status, body) in [
            ("503 Service Unavailable", "{}"),
            ("200 OK", "not json"),
            ("200 OK", "{}"),
        ] {
            let (base, server) = provider_http::tests::server(vec![(status, body.into())]);
            assert!(runtime.block_on(search_from(&base, "Song", 20)).is_err());
            assert_eq!(server.join().unwrap().len(), 1);
        }
    }

    fn album_response() -> Value {
        let mut row = song();
        row["more_info"]["album_id"] = "42".into();
        serde_json::json!({"id":"42", "title":"Yours Truly", "type":"album", "year":"2025",
            "more_info":{"artistMap":{"primary_artists":[{"id":"123456", "name":"KR$NA"}]}},
            "list":[row.clone(), row]})
    }

    #[test]
    fn album_uses_real_nested_credits_and_list_without_optional_metadata() {
        let mut response = album_response();
        let album = album_details("42", &response).unwrap();
        assert_eq!(album.info.artist, "KR$NA");
        assert_eq!(
            album.info.artists[0].id.as_deref(),
            Some("saavn:artist:123456")
        );
        assert_eq!(album.info.year, Some(2025));
        assert_eq!(album.tracks.len(), 1);
        assert_eq!(album.info.track_count, Some(1));
        assert!(!album.partial);
        assert_eq!(
            serde_json::to_value(&album).unwrap()["info"]["artworkUrl"],
            Value::Null
        );
        response["more_info"] = Value::Null;
        response["year"] = Value::Null;
        assert!(album_details("42", &response).is_ok());
        response["list"] = serde_json::json!([]);
        assert!(album_details("42", &response).unwrap().tracks.is_empty());
        response["list"] = Value::Null;
        assert!(album_details("42", &response).is_err());
    }

    #[test]
    fn album_preserves_provider_order_and_rejects_malformed_or_wrong_tracks() {
        let mut response = album_response();
        response["list"][1]["id"] = "AAAAAAAA".into();
        let album = album_details("42", &response).unwrap();
        assert_eq!(
            album
                .tracks
                .iter()
                .map(|track| track.id.as_str())
                .collect::<Vec<_>>(),
            ["saavn:QAbmbZ7O", "saavn:AAAAAAAA"]
        );
        response["list"][1]["more_info"]["album_id"] = "99".into();
        assert!(album_details("42", &response).is_err());
        response["list"][1] = serde_json::json!({"id":"broken"});
        assert!(album_details("42", &response).is_err());
        assert!(album_details("99", &album_response()).is_err());
    }

    #[test]
    fn artist_filters_exact_identity_and_associated_releases_without_requiring_portrait() {
        let mut row = song();
        row["more_info"]["artistMap"]["primary_artists"][0]["id"] = "123456".into();
        row["more_info"]["album_id"] = "42".into();
        let mut unrelated = row.clone();
        unrelated["id"] = "AAAAAAAA".into();
        unrelated["more_info"]["artistMap"]["primary_artists"][0] =
            serde_json::json!({"id":"9", "name":"KR$NA Tribute"});
        let response = serde_json::json!({"artistId":"123456", "name":"KR$NA", "topSongs":[row.clone(), row, unrelated],
            "topAlbums":[{"id":"99", "title":"Unrelated", "more_info":{"artistMap":{"primary_artists":[{"id":"9", "name":"Other"}]}}}],
            "singles":[{"id":"42", "title":"Yours Truly", "year":"2025", "more_info":{"song_count":"15", "artistMap":{"primary_artists":[{"id":"123456", "name":"KR$NA"}]}}}]});
        let artist = artist_details("123456", &response).unwrap();
        assert_eq!(artist.top_tracks.len(), 1);
        assert_eq!(artist.albums.len(), 1);
        assert_eq!(artist.albums[0].year, Some(2025));
        assert!(artist.info.artwork_url.is_none());
        assert!(artist_details("9", &response).is_err());
        assert!(!same_name("KR$NA", "KR$NA Tribute"));
        assert!(!same_name("KR$NA", "NA"));
    }

    #[test]
    fn artist_reads_live_nested_lists_and_rejects_empty_publishing_pages() {
        let mut row = song();
        row["more_info"]["artistMap"]["primary_artists"][0]["id"] = "123456".into();
        row["more_info"]["album_id"] = "42".into();
        let mut response = serde_json::json!({"artistId":"123456", "name":"KR$NA",
            "topSongs":{"songs":[row],"total":1},
            "topAlbums":{"albums":[{"id":"42","title":"Yours Truly","more_info":{"artistMap":{"primary_artists":[{"id":"123456","name":"KR$NA"}]}}}],"total":1}});
        let artist = artist_details("123456", &response).unwrap();
        assert_eq!(artist.top_tracks.len(), 1);
        assert_eq!(artist.albums.len(), 1);
        response["topSongs"]["songs"] = serde_json::json!([]);
        assert_eq!(artist_details("123456", &response).unwrap().albums.len(), 1);
        response["topAlbums"]["albums"] = serde_json::json!([]);
        response["name"] = "Jackie Young Music/Hola Amigo Songs".into();
        assert!(artist_details("123456", &response).is_err());
    }

    #[test]
    fn name_only_links_never_assign_a_provider_identity() {
        for id in [
            "saavn:artist:name:gini",
            "saavn:artist:Emiway",
            "saavn:artist:001",
            "saavn:artist:0",
        ] {
            assert!(runtime()
                .block_on(lookup_saavn_artist("invalid", id))
                .is_err());
        }
    }

    #[test]
    fn captured_provider_profiles_retain_exact_credits_and_releases() {
        let corpus: Value = serde_json::from_str(include_str!(
            "../../tests/fixtures/artist-identity-live.json"
        ))
        .unwrap();
        for source in ["1249318", "20043211"] {
            let label = format!("saavn-artist-{source}");
            let raw = corpus["responses"]
                .as_array()
                .unwrap()
                .iter()
                .find(|row| row["label"] == label)
                .unwrap();
            let profile = artist_details(source, &raw["data"]).unwrap();
            assert_eq!(profile.info.id, format!("saavn:artist:{source}"));
            assert!(profile.top_tracks.iter().all(|track| track
                .artists
                .iter()
                .any(|credit| credit.id.as_deref() == Some(&profile.info.id))));
            assert!(profile.albums.iter().all(|album| album
                .artists
                .iter()
                .any(|credit| credit.id.as_deref() == Some(&profile.info.id))));
            assert_eq!(
                profile
                    .top_tracks
                    .iter()
                    .any(|track| track.title == "Sukoon"),
                source == "20043211"
            );
        }
        let value = serde_json::json!({"primary_artists":[{"id":"1","name":"Gini"},{"id":"2","name":"Gini"},{"name":"gini"}],"featured_artists":[{"id":"3","name":"Guest"}]});
        let parsed = credits(&value);
        assert_eq!(parsed.len(), 4);
        assert!(parsed[2].id.is_none());
        let mut response = corpus["responses"]
            .as_array()
            .unwrap()
            .iter()
            .find(|row| row["label"] == "saavn-artist-20043211")
            .unwrap()["data"]
            .clone();
        let unrelated = corpus["responses"]
            .as_array()
            .unwrap()
            .iter()
            .find(|row| row["label"] == "saavn-artist-1249318")
            .unwrap()["data"]["topSongs"]["songs"][0]
            .clone();
        response["topSongs"]["songs"]
            .as_array_mut()
            .unwrap()
            .insert(0, unrelated);
        assert!(!artist_details("20043211", &response)
            .unwrap()
            .top_tracks
            .iter()
            .any(|track| track.title == "Don't Even Text"));
        assert!(artist_details("1249318", &response).is_err());
    }

    #[test]
    fn album_search_matches_title_and_credit_then_opens_the_full_release() {
        let runtime = runtime();
        let mut row = song();
        row["more_info"]["album"] = "Yours Truly".into();
        row["more_info"]["album_id"] = "42".into();
        let mut wrong = row.clone();
        wrong["id"] = "AAAAAAAA".into();
        wrong["more_info"]["artistMap"]["primary_artists"] = serde_json::json!([{"name":"Other"}]);
        let (base, server) = provider_http::tests::server(vec![
            (
                "200 OK",
                serde_json::json!({"results":[wrong, row]}).to_string(),
            ),
            ("200 OK", album_response().to_string()),
        ]);
        let album = runtime
            .block_on(lookup_saavn_album(
                &base,
                "saavn:album:search:KR%24NA:Yours%20Truly",
            ))
            .unwrap();
        assert_eq!(album.info.id, "saavn:album:42");
        assert!(!album.partial);
        assert_eq!(server.join().unwrap().len(), 2);
        for id in [
            "spotify:42",
            "saavn:album:0",
            "saavn:album:../file",
            "saavn:album:unknown:Yours Truly",
            "saavn:album:search::",
        ] {
            assert!(runtime.block_on(lookup_saavn_album("invalid", id)).is_err());
        }
    }

    #[test]
    fn entity_search_returns_provider_ids_deduplicates_and_keeps_partial_success() {
        let artist = serde_json::json!({"id":"123456", "name":"Artist", "type":"artist"});
        let (base, server) = provider_http::tests::server(vec![
            ("200 OK", serde_json::json!({"results":[artist.clone(), artist, {"id":"bad", "name":"Invalid", "type":"artist"}]}).to_string()),
            ("200 OK", serde_json::json!({"results":[album_response()]}).to_string()),
        ]);
        let entities = runtime()
            .block_on(search_entities_from(&base, "Artist"))
            .unwrap();
        assert_eq!(entities.artists.len(), 1);
        assert_eq!(entities.artists[0].id, "saavn:artist:123456");
        assert_eq!(entities.albums[0].id, "saavn:album:42");
        assert!(entities.warning.is_none());
        let requests = server.join().unwrap();
        assert!(requests[0].contains("search.getArtistResults"));
        assert!(requests[1].contains("search.getAlbumResults"));
        let (base, server) = provider_http::tests::server(vec![
            ("200 OK", "{}".into()),
            (
                "200 OK",
                serde_json::json!({"results":[album_response()]}).to_string(),
            ),
        ]);
        let entities = runtime()
            .block_on(search_entities_from(&base, "Album"))
            .unwrap();
        assert!(entities.artists.is_empty());
        assert_eq!(entities.albums.len(), 1);
        assert!(entities.warning.is_some());
        assert_eq!(server.join().unwrap().len(), 2);
    }

    #[test]
    fn album_search_labels_partial_results_and_rejects_ambiguous_releases() {
        let mut row = song();
        row["more_info"]["album"] = "Yours Truly".into();
        let (base, server) = provider_http::tests::server(vec![(
            "200 OK",
            serde_json::json!({"results":[row.clone()]}).to_string(),
        )]);
        let album = runtime()
            .block_on(lookup_saavn_album_by_search(&base, "KR$NA", "Yours Truly"))
            .unwrap();
        assert!(album.partial);
        assert_eq!(album.info.id, "saavn:album:search:KR%24NA:Yours%20Truly");
        assert_eq!(server.join().unwrap().len(), 1);
        row["more_info"]["album_id"] = "42".into();
        let mut another = row.clone();
        another["id"] = "AAAAAAAA".into();
        another["more_info"]["album_id"] = "99".into();
        let (base, server) = provider_http::tests::server(vec![(
            "200 OK",
            serde_json::json!({"results":[row,another]}).to_string(),
        )]);
        assert!(runtime()
            .block_on(lookup_saavn_album_by_search(&base, "KR$NA", "Yours Truly"))
            .is_err());
        assert_eq!(server.join().unwrap().len(), 1);
        assert!(runtime()
            .block_on(lookup_saavn_artist("invalid", "saavn:artist:0"))
            .is_err());
    }
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogArtist {
    pub id: String,
    pub name: String,
    pub artwork_url: Option<String>,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogAlbum {
    pub id: String,
    pub title: String,
    pub artist: String,
    pub artists: Vec<itunes_metadata::CatalogArtistCredit>,
    pub artwork_url: Option<String>,
    pub year: Option<u32>,
    pub track_count: Option<u32>,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtistDetails {
    #[serde(skip)]
    pub evidence: Vec<itunes_metadata::CatalogTrack>,
    pub verified_ids: Vec<String>,
    pub info: CatalogArtist,
    pub top_tracks: Vec<CatalogTrack>,
    pub albums: Vec<CatalogAlbum>,
    pub similar_artists: Vec<CatalogArtist>,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AlbumDetails {
    pub info: CatalogAlbum,
    pub tracks: Vec<CatalogTrack>,
    pub partial: bool,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogEntities {
    pub artists: Vec<CatalogArtist>,
    pub albums: Vec<CatalogAlbum>,
    pub warning: Option<String>,
}

fn artist_summary(row: &Value) -> Option<CatalogArtist> {
    if row["type"].as_str()? != "artist" {
        return None;
    }
    Some(CatalogArtist {
        id: format!("saavn:artist:{}", entity_id(&row["id"])?),
        name: name(&row["name"])?,
        artwork_url: artwork(&row["image"]),
    })
}

fn album_summary(row: &Value) -> Option<CatalogAlbum> {
    if row["type"].as_str()? != "album" {
        return None;
    }
    let artists = credits(&row["more_info"]["artistMap"]);
    Some(CatalogAlbum {
        id: format!("saavn:album:{}", entity_id(&row["id"])?),
        title: name(&row["title"])?,
        artist: artists
            .iter()
            .map(|a| a.name.as_str())
            .collect::<Vec<_>>()
            .join(", "),
        artists,
        artwork_url: artwork(&row["image"]),
        year: positive_number(&row["year"]),
        track_count: positive_number(&row["more_info"]["song_count"]),
    })
}

fn home_albums(response: &Value, language: &str) -> Result<Vec<CatalogAlbum>, String> {
    let rows = response
        .as_array()
        .ok_or("The discovery shelf is unavailable. Search music or try again later.")?;
    let mut ids = HashSet::new();
    let mut editions = HashSet::new();
    Ok(rows
        .iter()
        .filter(|row| row["language"].as_str() == Some(language))
        .filter_map(|row| {
            row.get("more_info")?
                .as_object()?
                .get("artistMap")?
                .as_object()?;
            let mut row = row.clone();
            // This feed puts album credits in artistMap.artists instead of primary_artists.
            if credits(&row["more_info"]["artistMap"]).is_empty() {
                row["more_info"]["artistMap"]["primary_artists"] =
                    row["more_info"]["artistMap"]["artists"].clone();
            }
            let mut album = album_summary(&row)?;
            album.year = album.year.or_else(|| {
                row["more_info"]["release_date"]
                    .as_str()?
                    .split('-')
                    .next()?
                    .parse::<u32>()
                    .ok()
                    .filter(|year| (1900..=2200).contains(year))
            });
            if !ids.insert(album.id.clone())
                || (!album.artist.is_empty()
                    && !editions.insert(format!(
                        "{}\0{}",
                        album.title.to_lowercase(),
                        album.artist.to_lowercase()
                    )))
            {
                return None;
            }
            Some(album)
        })
        .take(12)
        .collect())
}

#[tauri::command]
pub async fn discover_albums(language: String) -> Result<Vec<CatalogAlbum>, String> {
    if ![
        "english",
        "hindi",
        "tamil",
        "telugu",
        "malayalam",
        "kannada",
        "punjabi",
        "bengali",
        "marathi",
    ]
    .contains(&language.as_str())
    {
        return Err("Choose a supported discovery language.".into());
    }
    let response = request(
        BASE,
        "content.getTrending",
        &[
            ("entity_type", "album".into()),
            ("entity_language", language.clone()),
        ],
    )
    .await?;
    home_albums(&response, &language)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoverPage {
    new_albums: Vec<CatalogAlbum>,
    new_singles: Vec<CatalogTrack>,
    trending: Vec<CatalogTrack>,
    trending_items: Vec<TrendingItem>,
    charts: Vec<CatalogChart>,
    top_songs: Vec<CatalogTrack>,
    chart_title: String,
    warnings: Vec<String>,
}

#[derive(serde::Serialize)]
#[serde(tag = "kind", content = "item", rename_all = "lowercase")]
pub enum TrendingItem {
    Song(CatalogTrack),
    Album(CatalogAlbum),
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogChart {
    id: String,
    title: String,
    subtitle: String,
    artwork_url: Option<String>,
    track_count: Option<u32>,
}

fn chart_summary(row: &Value) -> Option<CatalogChart> {
    if row["type"].as_str() != Some("playlist") {
        return None;
    }
    Some(CatalogChart {
        id: format!("saavn:chart:{}", entity_id(&row["id"])?),
        title: name(&row["title"])?,
        subtitle: name(&row["subtitle"]).unwrap_or_else(|| "JioSaavn".into()),
        artwork_url: artwork(&row["image"]),
        track_count: positive_number(&row["list_count"])
            .or_else(|| positive_number(&row["more_info"]["song_count"])),
    })
}

fn chart_summaries(rows: &Value) -> Vec<CatalogChart> {
    let mut ids = HashSet::new();
    let mut titles = HashSet::new();
    rows.as_array()
        .into_iter()
        .flatten()
        .filter_map(chart_summary)
        .filter(|chart| {
            ids.insert(chart.id.clone())
                && titles.insert(
                    chart
                        .title
                        .to_lowercase()
                        .chars()
                        .filter(|c| c.is_alphanumeric())
                        .collect::<String>(),
                )
        })
        .take(40)
        .collect()
}

fn original_trending_title(title: &str) -> bool {
    static VARIANTS: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    !VARIANTS.get_or_init(|| regex::Regex::new(r"(?i)\b(?:remix(?:es|ed)?|lo[\s\-‐‑–—]?fi|slowed|sped[\s\-‐‑–—]?up|nightcore|mash[\s\-‐‑–—]?up|karaoke|reverb(?:ed)?)\b").unwrap()).is_match(title)
}

fn homepage_trending(response: &Value) -> Vec<TrendingItem> {
    let mut seen = HashSet::new();
    response["new_trending"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|row| {
            if !original_trending_title(row["title"].as_str()?) {
                return None;
            }
            let item = match row["type"].as_str()? {
                "song" => TrendingItem::Song(track(row)?),
                "album" => TrendingItem::Album(
                    home_albums(
                        &serde_json::json!([row]),
                        row["language"].as_str().unwrap_or_default(),
                    )
                    .ok()?
                    .into_iter()
                    .next()?,
                ),
                _ => return None,
            };
            let id = match &item {
                TrendingItem::Song(item) => &item.id,
                TrendingItem::Album(item) => &item.id,
            };
            seen.insert(id.clone()).then_some(item)
        })
        .take(24)
        .collect()
}

fn release_shelves(response: &Value) -> Result<(Vec<CatalogAlbum>, Vec<CatalogTrack>), String> {
    let rows = response["data"]
        .as_array()
        .ok_or("New releases are unavailable.")?;
    let mut albums = Vec::new();
    let mut singles = Vec::new();
    let mut seen = HashSet::new();
    for row in rows {
        if row["type"] == "song" {
            if let Some(song) = track(row) {
                if seen.insert(song.id.clone()) {
                    singles.push(song);
                }
            }
        } else if let Some(language) = row["language"].as_str() {
            if let Some(album) = home_albums(&serde_json::json!([row]), language)?
                .into_iter()
                .next()
            {
                if seen.insert(album.id.clone()) {
                    albums.push(album);
                }
            }
        }
    }
    albums.truncate(12);
    singles.truncate(12);
    Ok((albums, singles))
}

async fn discover_page_from(base: &str, languages: &[String]) -> Result<DiscoverPage, String> {
    let primary = languages.first().map(String::as_str).unwrap_or("english");
    let releases = request(
        base,
        "content.getAlbums",
        &[("languages", languages.join(",")), ("n", "40".into())],
    )
    .await;
    // Homepage language selection is cookie-based; query parameters are ignored by this endpoint.
    let cookie = format!("L={}", urlencoding::encode(&languages.join(",")));
    let trending =
        request_context_cookie(base, "webapi.getLaunchData", &[], "web6dot0", &cookie).await;
    let charts = request_context_cookie(
        base,
        "content.getCharts",
        &[],
        "web6dot0",
        "L=hindi%2Ctamil%2Cmalayalam%2Ctelugu%2Cenglish%2Ckannada%2Cpunjabi%2Cbengali%2Cmarathi",
    )
    .await;
    let mut result = DiscoverPage {
        new_albums: vec![],
        new_singles: vec![],
        trending: vec![],
        trending_items: vec![],
        charts: vec![],
        top_songs: vec![],
        chart_title: String::new(),
        warnings: vec![],
    };
    match releases.and_then(|value| release_shelves(&value)) {
        Ok((albums, singles)) => {
            result.new_albums = albums;
            result.new_singles = singles;
        }
        Err(_) => result
            .warnings
            .push("New releases couldn't load. Try refreshing.".into()),
    }
    if let Ok(ref rows) = trending {
        result.trending_items = homepage_trending(rows);
    }
    if result.trending_items.is_empty() {
        result.warnings.push(
            "JioSaavn's homepage trending couldn't load; showing song-only results if available."
                .into(),
        );
        if let Ok(rows) = request(
            base,
            "content.getTrending",
            &[
                ("entity_type", "song".into()),
                ("entity_language", primary.into()),
            ],
        )
        .await
        {
            let mut seen = HashSet::new();
            result.trending = rows
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(track)
                .filter(|song| original_trending_title(&song.title) && seen.insert(song.id.clone()))
                .take(8)
                .collect();
        }
    } else {
        result.trending = result
            .trending_items
            .iter()
            .filter_map(|item| match item {
                TrendingItem::Song(song) => Some(song.clone()),
                _ => None,
            })
            .collect();
    }
    if result.trending_items.is_empty() && result.trending.is_empty() {
        result
            .warnings
            .push("Trending tracks are unavailable right now.".into());
    }
    let chart_rows = charts
        .as_ref()
        .ok()
        .filter(|rows| rows.as_array().is_some_and(|rows| !rows.is_empty()))
        .or_else(|| trending.as_ref().ok().and_then(|value| value.get("charts")));
    if let Some(charts) = chart_rows {
        result.charts = chart_summaries(charts);
        let rows = charts.as_array().map(Vec::as_slice).unwrap_or(&[]);
        let chart = rows
            .iter()
            .find(|row| {
                name(&row["title"]).is_some_and(|title| title.to_lowercase().starts_with(primary))
            })
            .or_else(|| {
                rows.iter()
                    .find(|row| row["title"].as_str() == Some("India Superhits Top 50"))
            });
        if let Some(chart) = chart {
            if let Some(id) = entity_id(&chart["id"]) {
                if let Ok(details) = request(
                    base,
                    "playlist.getDetails",
                    &[("listid", id), ("n", "10".into()), ("p", "1".into())],
                )
                .await
                {
                    result.chart_title = name(&chart["title"]).unwrap_or_default();
                    let mut seen = HashSet::new();
                    result.top_songs = details["list"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .filter_map(track)
                        .filter(|song| seen.insert(song.id.clone()))
                        .take(10)
                        .collect();
                }
            }
        }
    }
    if result.charts.is_empty() {
        result
            .warnings
            .push("JioSaavn charts couldn't load. Refresh Discover to retry.".into());
    }
    if result.top_songs.is_empty() {
        result
            .warnings
            .push("The top songs chart couldn't load. Try refreshing.".into());
    }
    Ok(result)
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChartDetails {
    info: CatalogChart,
    tracks: Vec<CatalogTrack>,
    partial: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    warning: Option<String>,
}

async fn lookup_chart_from(base: &str, id: &str) -> Result<ChartDetails, String> {
    let source = id
        .strip_prefix("saavn:chart:")
        .filter(|value| {
            value
                .parse::<u64>()
                .ok()
                .is_some_and(|id| id > 0 && id.to_string() == *value)
        })
        .ok_or("Invalid JioSaavn chart ID.")?;
    let response = provider_http::optional_json(
        base,
        &[
            ("__call", "playlist.getDetails".into()),
            ("_format", "json".into()),
            ("_marker", "0".into()),
            ("api_version", "4".into()),
            ("ctx", "web6dot0".into()),
            ("listid", source.into()),
            ("n", "100".into()),
            ("p", "1".into()),
        ],
    )
    .await?;
    let info = chart_summary(&response)
        .filter(|chart| chart.id == id)
        .ok_or("The provider returned a different or invalid chart.")?;
    let rows = response["list"]
        .as_array()
        .ok_or("JioSaavn returned an invalid chart tracklist.")?;
    let mut seen = HashSet::new();
    let tracks: Vec<_> = rows
        .iter()
        .take(100)
        .filter_map(track)
        .filter(|song| seen.insert(song.id.clone()))
        .collect();
    if tracks.is_empty() {
        return Err("This chart has no playable catalog tracks right now. Try another chart or retry later.".into());
    }
    let partial = tracks.len() < rows.len()
        || info
            .track_count
            .is_some_and(|count| count as usize > tracks.len());
    Ok(ChartDetails {
        info,
        tracks,
        partial,
        warning: None,
    })
}

#[tauri::command]
pub async fn lookup_chart(id: String) -> Result<ChartDetails, String> {
    lookup_chart_from(BASE, &id).await
}

#[tauri::command]
pub async fn discover_page(languages: Vec<String>) -> Result<DiscoverPage, String> {
    let supported = [
        "english",
        "hindi",
        "tamil",
        "telugu",
        "malayalam",
        "kannada",
        "punjabi",
        "bengali",
        "marathi",
    ];
    if languages.is_empty()
        || languages.len() > supported.len()
        || languages
            .iter()
            .any(|language| !supported.contains(&language.as_str()))
    {
        return Err("Choose supported discovery languages.".into());
    }
    discover_page_from(BASE, &languages).await
}

async fn search_mood_tracks(
    base: &str,
    mood: &str,
    languages: &[String],
) -> Result<Vec<CatalogTrack>, String> {
    let (search_terms, genre_hints): (&[&str], &[&str]) = match mood.to_lowercase().as_str() {
        "party" => (
            &["party", "dance", "club", "upbeat"],
            &["Dance", "Electronic", "Pop"],
        ),
        "chill" => (
            &["chill", "relax", "calm", "acoustic"],
            &["Acoustic", "Indie", "Ambient"],
        ),
        "focus" => (
            &["instrumental", "lo-fi", "study", "ambient"],
            &["Classical", "Instrumental", "Ambient"],
        ),
        "workout" => (
            &["workout", "energy", "power", "gym"],
            &["Rock", "Hip-Hop", "Electronic"],
        ),
        "romance" => (
            &["romantic", "love", "ballad"],
            &["Romantic", "Ballad", "Soul", "Pop", "Indie"],
        ),
        "sad" => (
            &["sad", "melancholy", "emotional"],
            &["Ballad", "Indie", "Soul"],
        ),
        "sleep" => (
            &["sleep", "peaceful", "night", "calm"],
            &["Classical", "Ambient", "Acoustic"],
        ),
        "energize" => (
            &["energy", "upbeat", "motivational"],
            &["Pop", "Rock", "Electronic"],
        ),
        "commute" => (&["travel", "journey", "drive"], &["Pop", "Rock", "Indie"]),
        "gaming" => (
            &["intense", "epic", "electronic"],
            &["Electronic", "Rock", "Soundtrack"],
        ),
        "feel good" => (&["happy", "upbeat", "positive"], &["Pop", "Dance", "Indie"]),
        _ => return Err(format!("Mood '{}' is not supported.", mood)),
    };

    let mut tracks_by_id = std::collections::HashMap::new();
    let mut successful_searches = 0;
    for language in languages {
        for term in search_terms.iter() {
            let query = format!("{term} {language}");
            let tracks = match search_from(base, &query, 40).await {
                Ok(tracks) => {
                    successful_searches += 1;
                    tracks
                }
                Err(_) => continue,
            };
            for track in tracks {
                let language_matches = track
                    .language
                    .as_ref()
                    .is_none_or(|actual| actual.eq_ignore_ascii_case(language));
                let genre_matches = track.genre.as_ref().is_none_or(|actual| {
                    genre_hints
                        .iter()
                        .any(|hint| actual.to_lowercase().contains(&hint.to_lowercase()))
                });
                if language_matches && genre_matches {
                    tracks_by_id.entry(track.id.clone()).or_insert(track);
                }
            }
            if tracks_by_id.len() >= 30 {
                break;
            }
        }
        if tracks_by_id.len() >= 30 {
            break;
        }
    }

    if successful_searches == 0 {
        return Err(
            "The music catalog couldn't load this mood collection. Retry in a moment.".into(),
        );
    }
    let mut tracks: Vec<_> = tracks_by_id.into_values().collect();
    tracks.sort_by(|a, b| b.play_count.unwrap_or(0).cmp(&a.play_count.unwrap_or(0)));
    tracks.truncate(30);
    Ok(tracks)
}

#[tauri::command]
pub async fn search_mood_collection(
    mood: String,
    languages: Vec<String>,
) -> Result<ChartDetails, String> {
    let mood_trimmed = mood.trim();
    if mood_trimmed.is_empty() || mood_trimmed.len() > 50 {
        return Err("Invalid mood name.".into());
    }

    let supported = [
        "english",
        "hindi",
        "tamil",
        "telugu",
        "malayalam",
        "kannada",
        "punjabi",
        "bengali",
        "marathi",
    ];
    if languages.is_empty()
        || languages.len() > supported.len()
        || languages
            .iter()
            .any(|language| !supported.contains(&language.as_str()))
    {
        return Err("Choose supported languages.".into());
    }

    let tracks = search_mood_tracks(BASE, mood_trimmed, &languages).await?;

    Ok(ChartDetails {
        info: CatalogChart {
            id: format!("lumaire:mood:{}", urlencoding::encode(mood_trimmed)),
            title: format!("{} · Mood", mood_trimmed),
            subtitle: "Curated by metadata and play count".into(),
            artwork_url: None,
            track_count: Some(tracks.len() as u32),
        },
        tracks,
        partial: false,
        warning: Some("Search-based mood discovery using JioSaavn metadata. Not all tracks may match the mood perfectly.".into()),
    })
}

async fn search_genre_collection_from(
    base: &str,
    genre_trimmed: &str,
    languages: &[String],
) -> Result<ChartDetails, String> {
    if genre_trimmed.is_empty() || genre_trimmed.len() > 50 {
        return Err("Invalid genre name.".into());
    }

    let supported = [
        "english",
        "hindi",
        "tamil",
        "telugu",
        "malayalam",
        "kannada",
        "punjabi",
        "bengali",
        "marathi",
    ];
    if languages.is_empty()
        || languages.len() > supported.len()
        || languages
            .iter()
            .any(|language| !supported.contains(&language.as_str()))
    {
        return Err("Choose supported languages.".into());
    }

    let genre_aliases: &[&str] = match genre_trimmed.to_lowercase().as_str() {
        "pop" => &["pop", "popular"],
        "rock" => &["rock"],
        "hip hop" => &["hip hop", "hip-hop", "rap"],
        "jazz" => &["jazz"],
        "classical" => &["classical"],
        "electronic" => &["electronic", "edm", "dance"],
        "indie" => &["indie", "independent"],
        "soul" => &["soul"],
        "r&b" => &["r&b", "rnb", "rhythm and blues"],
        "folk" => &["folk"],
        "metal" => &["metal", "heavy metal"],
        "blues" => &["blues"],
        _ => return Err(format!("Genre '{}' is not supported.", genre_trimmed)),
    };
    let genre_key = genre_trimmed.to_lowercase();
    let mut tracks_by_id = std::collections::HashMap::new();
    let mut successful_searches = 0;
    for language in languages {
        let query = format!("{genre_trimmed} {language}");
        let Ok(results) = search_from(base, &query, 60).await else {
            continue;
        };
        successful_searches += 1;
        for track in results {
            let language_matches = track.language.as_ref().is_none_or(|actual| {
                languages
                    .iter()
                    .any(|selected| actual.eq_ignore_ascii_case(selected))
            });
            let metadata_matches = track.genre.as_ref().is_some_and(|actual| {
                let actual = actual.to_lowercase();
                genre_aliases.iter().any(|alias| actual.contains(alias))
            });
            if language_matches && metadata_matches {
                tracks_by_id.entry(track.id.clone()).or_insert(track);
            }
        }
        if tracks_by_id.len() >= 50 {
            break;
        }
    }
    if successful_searches == 0 {
        return Err(
            "The music catalog couldn't load this genre collection. Retry in a moment.".into(),
        );
    }
    let mut tracks: Vec<CatalogTrack> = tracks_by_id.into_values().collect();
    tracks.sort_by(|a, b| {
        let a_match = a
            .genre
            .as_deref()
            .is_some_and(|value| value.to_lowercase().contains(&genre_key));
        let b_match = b
            .genre
            .as_deref()
            .is_some_and(|value| value.to_lowercase().contains(&genre_key));
        b_match
            .cmp(&a_match)
            .then_with(|| b.play_count.unwrap_or(0).cmp(&a.play_count.unwrap_or(0)))
    });
    tracks.truncate(50);

    Ok(ChartDetails {
        info: CatalogChart {
            id: format!("lumaire:genre:{}", urlencoding::encode(genre_trimmed)),
            title: format!("{} · Genre", genre_trimmed),
            subtitle: "Filtered by genre metadata".into(),
            artwork_url: None,
            track_count: Some(tracks.len() as u32),
        },
        tracks,
        partial: false,
        warning: Some(
            "Genre-based filtering using JioSaavn metadata. Some tracks may not have genre tags."
                .into(),
        ),
    })
}

#[tauri::command]
pub async fn search_genre_collection(
    genre: String,
    languages: Vec<String>,
) -> Result<ChartDetails, String> {
    let genre = genre.trim();
    search_genre_collection_from(BASE, genre, &languages).await
}

#[cfg(test)]
mod collection_tests {
    use super::*;
    include!("catalog_collection_tests.rs");
}

#[cfg(test)]
mod home_tests {
    use super::*;
    #[test]
    #[ignore = "explicit public JioSaavn homepage comparison; requires network"]
    fn live_homepage_trending() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let page = runtime
            .block_on(discover_page_from(
                BASE,
                &["hindi".into(), "english".into(), "tamil".into()],
            ))
            .unwrap();
        assert!(!page.trending_items.is_empty());
        let rows = serde_json::to_value(&page.trending_items).unwrap();
        let kinds: HashSet<_> = rows
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|row| row["kind"].as_str())
            .collect();
        assert!(kinds.contains("album") && kinds.contains("song") && !kinds.contains("playlist"));
        for row in rows.as_array().unwrap().iter().take(10) {
            println!(
                "{}: {}",
                row["kind"].as_str().unwrap(),
                row["item"]["title"].as_str().unwrap()
            );
        }
        println!(
            "Homepage items: {}; compatible recommendation songs: {}",
            page.trending_items.len(),
            page.trending.len()
        );
    }
    #[test]
    #[ignore = "explicit regional JioSaavn chart coverage check; requires network"]
    fn live_jiosaavn_chart_coverage() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let page = runtime
            .block_on(discover_page_from(
                BASE,
                &["hindi".into(), "english".into(), "tamil".into()],
            ))
            .unwrap();
        for prefix in [
            "hindi:",
            "tamil:",
            "malayalam:",
            "telugu:",
            "international",
            "india superhits",
        ] {
            let chart = page
                .charts
                .iter()
                .find(|chart| chart.title.to_lowercase().starts_with(prefix))
                .expect("Requested regional chart must exist in this live comparison");
            let details = runtime
                .block_on(lookup_chart_from(BASE, &chart.id))
                .unwrap();
            assert!(!details.tracks.is_empty());
            println!(
                "{} | {} | {} tracks | partial={} | artwork={} | first={}",
                chart.id,
                chart.title,
                details.tracks.len(),
                details.partial,
                chart.artwork_url.is_some(),
                details.tracks[0].title
            );
        }
        assert!(page.trending_items.iter().all(|item| match item {
            TrendingItem::Song(song) => original_trending_title(&song.title),
            TrendingItem::Album(album) => original_trending_title(&album.title),
        }));
    }
    fn song_fixture(id: &str) -> Value {
        serde_json::json!({"id":id,"title":"New single","type":"song","language":"tamil","image":"https://c.saavncdn.com/cover.jpg","more_info":{"duration":"180","album_id":"42","album":"Release","artistMap":{"primary_artists":[{"id":"9","name":"Singer"}]}}})
    }
    #[test]
    fn release_shelves_separate_real_albums_and_singles_and_reject_bad_rows() {
        let album = serde_json::json!({"id":"42","title":"New album","type":"album","language":"tamil","more_info":{"release_date":"2026-10-23","artistMap":{"artists":[{"id":"9","name":"Singer"}]}}});
        let single = song_fixture("abcdefgh");
        let (albums, singles) = release_shelves(&serde_json::json!({"data":[album, single, song_fixture("abcdefgh"), {"type":"song","id":"invalid"}]})).unwrap();
        assert_eq!(albums.len(), 1);
        assert_eq!(albums[0].year, Some(2026));
        assert_eq!(singles.len(), 1);
        assert_eq!(singles[0].id, "saavn:abcdefgh");
        assert!(release_shelves(&serde_json::json!({})).is_err());
    }
    #[test]
    fn homepage_trending_preserves_song_album_order_and_filters_playlists_and_variants() {
        let album = serde_json::json!({"id":"42","title":"Current album","type":"album","language":"tamil","more_info":{"release_date":"2026-10-23","artistMap":{"artists":[{"id":"9","name":"Singer"}]}}});
        let playlist = serde_json::json!({"id":"99","title":"Now Trending","subtitle":"66.7K Fans","type":"playlist","perma_url":"https://www.jiosaavn.com/featured/now-trending/BECHl0fsh08_"});
        let rows = homepage_trending(
            &serde_json::json!({"new_trending":[album, song_fixture("abcdefgh"), playlist, album, {"type":"podcast"}, {"type":"song","id":"invalid"}]}),
        );
        let serialized = serde_json::to_value(rows).unwrap();
        assert_eq!(serialized[0]["kind"], "album");
        assert_eq!(serialized[0]["item"]["artist"], "Singer");
        assert_eq!(serialized[1]["kind"], "song");
        assert_eq!(serialized.as_array().unwrap().len(), 2);
        assert!(homepage_trending(&serde_json::json!({"new_trending":[playlist]})).is_empty());
        for title in [
            "Song (Remix)",
            "Song (Lo-fi Version)",
            "Song (Lo–fi Version)",
            "Song Slowed + Reverb",
            "Song Sped Up",
            "Song Mashup",
            "Song Nightcore",
        ] {
            let mut variant = song_fixture("abcdefgh");
            variant["title"] = title.into();
            let mut variant_album = album.clone();
            variant_album["title"] = title.into();
            assert!(homepage_trending(
                &serde_json::json!({"new_trending":[variant, variant_album]})
            )
            .is_empty());
        }
        assert!(homepage_trending(&serde_json::json!({"new_trending":{}})).is_empty());
    }
    #[test]
    fn discover_http_uses_release_feed_and_named_chart_with_validated_track_ids() {
        let song = song_fixture("abcdefgh");
        let (endpoint, server) = crate::provider_http::tests::server(vec![
            ("200 OK", serde_json::json!({"data":[song]}).to_string()),
            (
                "200 OK",
                serde_json::json!({"new_trending":[song]}).to_string(),
            ),
            (
                "200 OK",
                serde_json::json!([{"id":"99","title":"Tamil: Top 50","type":"playlist"}])
                    .to_string(),
            ),
            ("200 OK", serde_json::json!({"list":[song]}).to_string()),
        ]);
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let page = runtime
            .block_on(discover_page_from(
                &endpoint,
                &["tamil".into(), "english".into()],
            ))
            .unwrap();
        assert_eq!(page.new_singles.len(), 1);
        assert_eq!(page.trending.len(), 1);
        assert_eq!(page.trending_items.len(), 1);
        assert_eq!(page.top_songs.len(), 1);
        assert_eq!(page.charts.len(), 1);
        assert_eq!(page.chart_title, "Tamil: Top 50");
        assert!(page.warnings.is_empty());
        let requests = server.join().unwrap();
        assert_eq!(requests.len(), 4);
        assert!(requests[0].contains("content.getAlbums"));
        assert!(requests[1].contains("webapi.getLaunchData"));
        assert!(requests[1]
            .to_lowercase()
            .contains("cookie: l=tamil%2cenglish"));
        assert!(requests[2]
            .to_lowercase()
            .contains("malayalam%2ctelugu%2cenglish"));
        assert!(requests[3].contains("listid=99"));
    }
    #[test]
    fn failed_homepage_keeps_song_fallback_without_discarding_other_feeds() {
        let song = song_fixture("abcdefgh");
        let (endpoint, server) = crate::provider_http::tests::server(vec![
            ("200 OK", serde_json::json!({"data":[song]}).to_string()),
            ("200 OK", "{}".into()),
            ("200 OK", "[]".into()),
            ("200 OK", serde_json::json!([song]).to_string()),
        ]);
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let page = runtime
            .block_on(discover_page_from(
                &endpoint,
                &["tamil".into(), "english".into()],
            ))
            .unwrap();
        assert_eq!(page.new_singles.len(), 1);
        assert_eq!(page.trending.len(), 1);
        assert!(page.trending_items.is_empty());
        assert!(page
            .warnings
            .iter()
            .any(|warning| warning.contains("song-only")));
        assert!(server.join().unwrap()[3].contains("content.getTrending"));
    }
    #[test]
    fn failed_discover_feeds_remain_partial_instead_of_blocking_browsing() {
        let (endpoint, server) = crate::provider_http::tests::server(vec![
            ("200 OK", "{}".into()),
            ("200 OK", "[]".into()),
            ("200 OK", "[]".into()),
            ("200 OK", "[]".into()),
        ]);
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let page = runtime
            .block_on(discover_page_from(&endpoint, &["english".into()]))
            .unwrap();
        assert_eq!(page.warnings.len(), 5);
        assert!(page.top_songs.is_empty());
        assert_eq!(server.join().unwrap().len(), 4);
        assert!(runtime
            .block_on(discover_page(vec!["unsupported".into()]))
            .is_err());
    }
    #[test]
    fn home_feed_validates_language_identity_credits_and_duplicate_editions() {
        let row = serde_json::json!({"id":"42", "type":"album", "title":"A &amp; B", "language":"tamil", "image":"https://c.saavncdn.com/cover.jpg", "more_info":{"release_date":"2026-10-20", "artistMap":{"artists":[{"id":"9","name":"Composer"}]}}});
        let mut duplicate = row.clone();
        duplicate["id"] = "43".into();
        let mut other_language = row.clone();
        other_language["language"] = "hindi".into();
        let albums = home_albums(&serde_json::json!([row, duplicate, other_language, {"id":"oops"}, {"language":"tamil", "more_info":[]}]), "tamil").unwrap();
        assert_eq!(albums.len(), 1);
        assert_eq!(albums[0].id, "saavn:album:42");
        assert_eq!(albums[0].title, "A & B");
        assert_eq!(albums[0].artist, "Composer");
        assert_eq!(albums[0].year, Some(2026));
        assert!(home_albums(&serde_json::json!({"error":"unavailable"}), "tamil").is_err());
    }
    #[test]
    fn charts_preserve_provider_identity_order_artwork_and_deduplicate() {
        let row = serde_json::json!({"id":"99","type":"playlist","title":"Tamil: India Superhits Top 50","image":"https://c.saavncdn.com/chart.jpg","more_info":{"song_count":"50"}});
        let mut duplicate_title = row.clone();
        duplicate_title["id"] = "100".into();
        let charts = chart_summaries(
            &serde_json::json!([row, row, duplicate_title, {"id":"101","type":"album","title":"Not a chart"}]),
        );
        assert_eq!(charts.len(), 1);
        assert_eq!(charts[0].id, "saavn:chart:99");
        assert_eq!(charts[0].track_count, Some(50));
        assert_eq!(
            charts[0].artwork_url.as_deref(),
            Some("https://c.saavncdn.com/chart.jpg")
        );
    }
    #[test]
    fn chart_tracklists_validate_identity_keep_ranked_tracks_and_mark_partial_results() {
        let mut remix = song_fixture("ijklmnop");
        remix["title"] = "Song (Remix)".into();
        let response = serde_json::json!({"id":"99","type":"playlist","title":"Malayalam: India Superhits Top 50","list_count":"50","list":[song_fixture("abcdefgh"),remix,song_fixture("abcdefgh"),{"id":"invalid","type":"song"}]});
        let (base, server) =
            crate::provider_http::tests::server(vec![("200 OK", response.to_string())]);
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let chart = runtime
            .block_on(lookup_chart_from(&base, "saavn:chart:99"))
            .unwrap();
        assert_eq!(
            chart
                .tracks
                .iter()
                .map(|track| track.id.as_str())
                .collect::<Vec<_>>(),
            ["saavn:abcdefgh", "saavn:ijklmnop"]
        );
        assert!(chart.partial);
        let requests = server.join().unwrap();
        assert_eq!(requests.len(), 1);
        assert!(
            requests[0].contains("playlist.getDetails")
                && requests[0].contains("listid=99")
                && requests[0].contains("n=100")
        );
        for response in [
            serde_json::json!({"id":"100","type":"playlist","title":"Wrong chart","list":[song_fixture("abcdefgh")]}),
            serde_json::json!({"id":"99","type":"playlist","title":"Empty chart","list":[]}),
        ] {
            let (base, server) =
                crate::provider_http::tests::server(vec![("200 OK", response.to_string())]);
            assert!(runtime
                .block_on(lookup_chart_from(&base, "saavn:chart:99"))
                .is_err());
            server.join().unwrap();
        }
        for id in [
            "99",
            "saavn:chart:0",
            "saavn:chart:01",
            "saavn:chart:-1",
            "saavn:chart:18446744073709551616",
            "https://evil.test",
        ] {
            assert!(runtime
                .block_on(lookup_chart_from("http://127.0.0.1:1", id))
                .err()
                .unwrap()
                .contains("Invalid JioSaavn chart ID"));
        }
    }
    #[test]
    fn chart_listing_recovers_from_empty_endpoint_using_homepage_charts() {
        let song = song_fixture("abcdefgh");
        let (base, server) = crate::provider_http::tests::server(vec![
            ("200 OK", serde_json::json!({"data":[song]}).to_string()),
            ("200 OK", serde_json::json!({"new_trending":[song],"charts":[{"id":"99","type":"playlist","title":"Tamil: Top 50"}]}).to_string()),
            ("200 OK", "[]".into()), ("200 OK", serde_json::json!({"list":[song]}).to_string()),
        ]);
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let page = runtime
            .block_on(discover_page_from(&base, &["tamil".into()]))
            .unwrap();
        assert_eq!(page.charts.len(), 1);
        assert_eq!(page.top_songs.len(), 1);
        assert_eq!(server.join().unwrap().len(), 4);
    }
}

#[tauri::command]
pub async fn search_catalog_entities(app: tauri::AppHandle, query: String, request_id: Option<String>) -> Result<CatalogEntities, String> {
    let original_query = query.clone();
    let query = query.trim();
    if !(1..=200).contains(&query.chars().count()) || query.chars().any(char::is_control) {
        return Err("Enter a catalog search between 1 and 200 characters.".into());
    }
    let rows = crate::catalog_search::entities(query).await?;
    let candidates = if rows.warning.is_none() { rows.artists.clone() } else { vec![] };
    tauri::async_runtime::spawn(async move {
        use tauri::Emitter;
        for profile in crate::catalog_search::resolve_artists(&original_query, &candidates).await {
            let _ = app.emit("artist-resolution", serde_json::json!({ "query": original_query, "requestId": request_id, "verifiedIds": profile.verified_ids, "artist": profile.info }));
        }
    });
    Ok(rows)
}

pub(crate) async fn search_entities_from(
    base: &str,
    query: &str,
) -> Result<CatalogEntities, String> {
    let params = [("q", query.into()), ("n", "6".into()), ("p", "1".into())];
    let artists = request(base, "search.getArtistResults", &params).await;
    let albums = request(base, "search.getAlbumResults", &params).await;
    let rows = |response: Result<Value, String>| -> Result<Vec<Value>, String> {
        response?["results"]
            .as_array()
            .cloned()
            .ok_or("The catalog search response has no results list.".into())
    };
    let artists = rows(artists);
    let albums = rows(albums);
    if artists.is_err() && albums.is_err() {
        return Err("Artist and album search is unavailable. Please retry.".into());
    }
    let warning = if artists.is_err() {
        Some("Artist results are unavailable. Please retry.".into())
    } else if albums.is_err() {
        Some("Album results are unavailable. Please retry.".into())
    } else {
        None
    };
    let mut seen = HashSet::new();
    let artists = artists
        .unwrap_or_default()
        .iter()
        .filter_map(artist_summary)
        .filter(|a| seen.insert(a.id.clone()))
        .take(6)
        .collect();
    let mut seen = HashSet::new();
    let albums = albums
        .unwrap_or_default()
        .iter()
        .filter_map(album_summary)
        .filter(|a| seen.insert(a.id.clone()))
        .take(6)
        .collect();
    Ok(CatalogEntities {
        artists,
        albums,
        warning,
    })
}

fn lookup_name(encoded: &str) -> Result<String, String> {
    let decoded = urlencoding::decode(encoded).map_err(|_| "Invalid catalog name encoding.")?;
    let value = decoded.trim();
    if !(1..=200).contains(&value.chars().count()) || value.chars().any(char::is_control) {
        return Err("Catalog names must contain between 1 and 200 characters.".into());
    }
    Ok(value.to_string())
}

fn album_reference(track: &CatalogTrack, artist: &str) -> String {
    track.album_id.clone().unwrap_or_else(|| {
        format!(
            "saavn:album:search:{}:{}",
            urlencoding::encode(artist),
            urlencoding::encode(&track.album)
        )
    })
}

fn track_albums(tracks: &[CatalogTrack], artist: &str) -> Vec<CatalogAlbum> {
    let mut seen = HashSet::new();
    tracks
        .iter()
        .filter(|track| !track.album.is_empty())
        .filter_map(|track| {
            let id = album_reference(track, artist);
            seen.insert(id.clone()).then(|| CatalogAlbum {
                id,
                title: track.album.clone(),
                artist: track.artist.clone(),
                artists: track.artists.clone(),
                artwork_url: track.artwork_url.clone(),
                year: None,
                track_count: None,
            })
        })
        .collect()
}

#[tauri::command]
pub async fn lookup_artist(id: String) -> Result<ArtistDetails, String> {
    crate::catalog_search::artist(&id).await
}

pub(crate) async fn lookup_saavn_artist(base: &str, id: &str) -> Result<ArtistDetails, String> {
    let source = id
        .strip_prefix("saavn:artist:")
        .ok_or("Unsupported artist ID. Reopen the artist from Discover.")?;
    if let Some(number) = entity_id(&Value::String(source.into())) {
        let response = request(
            base,
            "artist.getArtistPageDetails",
            &[("artistId", number.clone())],
        )
        .await?;
        return artist_details(&number, &response);
    }
    if !source.is_empty() && source.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err("Invalid Saavn artist ID. Reopen the artist from Discover.".into());
    }
    Err("Artist identity is unresolved. Search and select a provider artist result.".into())
}

fn artist_details(source: &str, response: &Value) -> Result<ArtistDetails, String> {
    if entity_id(&response["artistId"]).as_deref() != Some(source) {
        return Err("This catalog artist is unavailable or returned a different artist.".into());
    }
    let artist_name = name(&response["name"]).ok_or("The catalog artist response has no name.")?;
    let id = format!("saavn:artist:{source}");
    let mut seen = HashSet::new();
    let top_tracks: Vec<_> = response["topSongs"]
        .as_array()
        .or_else(|| response["topSongs"]["songs"].as_array())
        .into_iter()
        .flatten()
        .filter_map(track)
        .filter(|track| {
            track
                .artists
                .iter()
                .any(|credit| credit.id.as_deref() == Some(&id))
        })
        .filter(|track| seen.insert(track.id.clone()))
        .take(100)
        .collect();
    let mut albums = track_albums(&top_tracks, &artist_name);
    let mut seen: HashSet<_> = albums.iter().map(|album| album.id.clone()).collect();
    for row in ["topAlbums", "singles", "latest_release"]
        .iter()
        .flat_map(|key| {
            response[key]
                .as_array()
                .or_else(|| response[key]["albums"].as_array())
                .into_iter()
                .flatten()
        })
    {
        let artists = credits(&row["more_info"]["artistMap"]);
        if !artists
            .iter()
            .any(|credit| credit.id.as_deref() == Some(&id))
        {
            continue;
        }
        if let (Some(source), Some(title)) = (entity_id(&row["id"]), name(&row["title"])) {
            let id = format!("saavn:album:{source}");
            let album = CatalogAlbum {
                id: id.clone(),
                title,
                artist: artists
                    .iter()
                    .map(|a| a.name.as_str())
                    .collect::<Vec<_>>()
                    .join(", "),
                artists,
                artwork_url: artwork(&row["image"]),
                year: positive_number(&row["year"]),
                track_count: positive_number(&row["more_info"]["song_count"]),
            };
            if seen.insert(id.clone()) {
                albums.push(album);
            } else if let Some(existing) = albums.iter_mut().find(|album| album.id == id) {
                *existing = album;
            }
        }
    }
    if top_tracks.is_empty() && albums.is_empty() {
        return Err("No credited music is available for this catalog artist.".into());
    }
    Ok(ArtistDetails {
        evidence: top_tracks.clone(),
        verified_ids: vec![],
        info: CatalogArtist {
            id,
            name: artist_name,
            artwork_url: artwork(&response["image"]),
        },
        top_tracks: top_tracks.into_iter().take(10).collect(),
        albums,
        similar_artists: response["similarArtists"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|row| {
                Some(CatalogArtist {
                    id: format!("saavn:artist:{}", entity_id(&row["id"])?),
                    name: name(&row["name"])?,
                    artwork_url: artwork(&row["image_url"]).or_else(|| artwork(&row["image"])),
                })
            })
            .take(5)
            .collect(),
    })
}

fn positive_number(value: &Value) -> Option<u32> {
    value
        .as_str()
        .and_then(|v| v.parse().ok())
        .or_else(|| value.as_u64().and_then(|v| u32::try_from(v).ok()))
        .filter(|v| *v > 0)
}

#[tauri::command]
pub async fn lookup_album(id: String) -> Result<AlbumDetails, String> {
    crate::catalog_search::album(&id).await
}

pub(crate) async fn lookup_saavn_album(base: &str, id: &str) -> Result<AlbumDetails, String> {
    let source = id
        .strip_prefix("saavn:album:")
        .ok_or("Unsupported album ID. Reopen the album from Discover.")?;
    if let Some(search) = source.strip_prefix("search:") {
        let (artist, title) = search
            .split_once(':')
            .ok_or("The album search link is missing its credited artist or title.")?;
        return lookup_saavn_album_by_search(base, &lookup_name(artist)?, &lookup_name(title)?)
            .await;
    }
    if source.starts_with("unknown:") {
        return Err(
            "This older album link has no credited artist. Reopen the album from its artist page."
                .into(),
        );
    }
    let source = entity_id(&Value::String(source.into()))
        .ok_or("Invalid Saavn album ID. Reopen the album from Discover.")?;
    let response = request(
        base,
        "content.getAlbumDetails",
        &[("albumid", source.clone())],
    )
    .await?;
    album_details(&source, &response)
}

fn album_details(source: &str, response: &Value) -> Result<AlbumDetails, String> {
    if entity_id(&response["id"]).as_deref() != Some(source) {
        return Err("This catalog album is unavailable or returned a different album.".into());
    }
    let title = name(&response["title"]).ok_or("The catalog album response has no title.")?;
    let songs = response["list"]
        .as_array()
        .or_else(|| response["songs"].as_array())
        .ok_or("The catalog album response has no track list.")?;
    let id = format!("saavn:album:{source}");
    let mut seen = HashSet::new();
    let mut tracks = Vec::new();
    for row in songs {
        let mut track =
            track(row).ok_or("The catalog returned a malformed album track. Please retry.")?;
        if track
            .album_id
            .as_ref()
            .is_some_and(|album_id| album_id != &id)
        {
            return Err("The catalog returned tracks from a different album.".into());
        }
        track.album_id = Some(id.clone());
        if track.album.is_empty() {
            track.album = title.clone();
        }
        if seen.insert(track.id.clone()) {
            tracks.push(track);
        }
    }
    let mut artists = credits(&response["more_info"]["artistMap"]);
    if artists.is_empty() {
        let mut seen = HashSet::new();
        artists = tracks
            .iter()
            .flat_map(|track| track.artists.clone())
            .filter(|credit| seen.insert(credit.id.clone().unwrap_or_else(|| credit.name.clone())))
            .collect();
    }
    let artist = artists
        .iter()
        .map(|a| a.name.as_str())
        .collect::<Vec<_>>()
        .join(", ");
    Ok(AlbumDetails {
        info: CatalogAlbum {
            id,
            title,
            artist,
            artists,
            artwork_url: artwork(&response["image"]),
            year: positive_number(&response["year"]),
            track_count: Some(tracks.len() as u32),
        },
        tracks,
        partial: false,
    })
}

async fn lookup_saavn_album_by_search(
    base: &str,
    artist: &str,
    title: &str,
) -> Result<AlbumDetails, String> {
    let tracks: Vec<_> = search_from(base, &format!("{title} {artist}"), 30)
        .await?
        .into_iter()
        .filter(|track| {
            same_name(&track.album, title)
                && track
                    .artists
                    .iter()
                    .any(|credit| same_name(&credit.name, artist))
        })
        .collect();
    let ids: HashSet<_> = tracks
        .iter()
        .filter_map(|track| track.album_id.as_deref())
        .collect();
    if ids.len() > 1 {
        return Err("Several releases match this album and artist. Open a result with a catalog album ID from Discover.".into());
    }
    if let Some(id) = ids.into_iter().next() {
        let source = id
            .strip_prefix("saavn:album:")
            .ok_or("Invalid search album ID.")?;
        let response = request(
            base,
            "content.getAlbumDetails",
            &[("albumid", source.into())],
        )
        .await?;
        let album = album_details(source, &response)?;
        if !same_name(&album.info.title, title)
            || !album.tracks.iter().any(|track| {
                track
                    .artists
                    .iter()
                    .any(|credit| same_name(&credit.name, artist))
            })
        {
            return Err("The resolved album does not match the requested title and artist.".into());
        }
        return Ok(album);
    }
    let first = tracks
        .first()
        .ok_or("No catalog tracks match both this album title and credited artist.")?;
    Ok(AlbumDetails {
        info: CatalogAlbum {
            id: album_reference(first, artist),
            title: title.into(),
            artist: first.artist.clone(),
            artists: first.artists.clone(),
            artwork_url: first.artwork_url.clone(),
            year: None,
            track_count: Some(tracks.len() as u32),
        },
        tracks,
        partial: true,
    })
}
