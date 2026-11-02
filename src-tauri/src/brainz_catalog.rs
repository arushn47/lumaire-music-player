//! Stable MusicBrainz recording/release identities, never audio URLs.
use crate::{catalog::{AlbumDetails, ArtistDetails, CatalogAlbum, CatalogArtist}, itunes_metadata::{CatalogArtistCredit, CatalogTrack}, music_metadata};
use serde_json::Value;
const BASE: &str = "https://musicbrainz.org/ws/2";
fn uuid(value: &str) -> Option<String> { let id = uuid::Uuid::parse_str(value).ok()?; (id.to_string() == value).then(|| value.into()) }
fn text(value: &Value) -> Option<String> { let value = value.as_str()?.trim(); (!value.is_empty() && value.len() <= 4000 && !value.chars().any(char::is_control)).then(|| value.into()) }
fn credits(value: &Value) -> Vec<CatalogArtistCredit> {
    value.as_array().into_iter().flatten().filter_map(|credit| Some(CatalogArtistCredit { name: text(&credit["name"]).or_else(|| text(&credit["artist"]["name"]))?, id: credit["artist"]["id"].as_str().and_then(uuid).map(|id| format!("musicbrainz:artist:{id}")) })).collect()
}
fn release(value: &Value, fallback: &[CatalogArtistCredit]) -> Option<CatalogAlbum> {
    let id = uuid(value["id"].as_str()?)?;
    let own = credits(&value["artist-credit"]); let artists = if own.is_empty() { fallback.to_vec() } else { own };
    Some(CatalogAlbum { id: format!("musicbrainz:release:{id}"), title: text(&value["title"])?, artist: artists.iter().map(|credit| credit.name.clone()).collect::<Vec<_>>().join(", "), artists, artwork_url: Some(format!("https://coverartarchive.org/release/{id}/front-250")), year: value["date"].as_str().and_then(music_metadata::date).and_then(|date| date.get(..4)?.parse().ok()), track_count: None })
}
fn recording(value: &Value, fallback_release: Option<&CatalogAlbum>) -> Option<CatalogTrack> {
    let id = uuid(value["id"].as_str()?)?; let artists = credits(&value["artist-credit"]);
    if artists.is_empty() { return None; }
    let duration = value["length"].as_u64().filter(|length| (1000..=86400000).contains(length))? as f64 / 1000.0;
    let album = fallback_release.cloned().or_else(|| value["releases"].as_array()?.iter().find_map(|row| release(row, &artists)));
    Some(CatalogTrack { recording_metadata: crate::recording_metadata::from_provider(format!("musicbrainz:recording:{id}"), &value["isrcs"], value["first-release-date"].as_str(), &value["artist-credit"]), play_count: None, id: format!("musicbrainz:recording:{id}"), title: text(&value["title"])?, artist: artists.iter().map(|credit| credit.name.clone()).collect::<Vec<_>>().join(", "), artist_id: artists.first()?.id.clone(), artists, album: album.as_ref().map(|album| album.title.clone()).unwrap_or_default(), album_id: album.as_ref().map(|album| album.id.clone()), duration, artwork_url: album.and_then(|album| album.artwork_url), genre: None, language: None })
}
async fn get(path: &str, params: &[(&str, String)]) -> Result<Value, String> {
    let mut params = params.to_vec(); params.push(("fmt", "json".into())); music_metadata::brainz_json(&format!("{BASE}/{path}"), &params).await
}
pub async fn search(query: &str) -> Result<Vec<CatalogTrack>, String> {
    let escaped = query.replace('\\', "\\\\").replace('"', "\\\"");
    let value = get("recording/", &[("query", escaped), ("limit", "25".into())]).await?;
    Ok(value["recordings"].as_array().into_iter().flatten().filter(|row| row["score"].as_u64().or_else(|| row["score"].as_str()?.parse().ok()).unwrap_or(0) >= 95).filter_map(|row| recording(row, None)).collect())
}
pub async fn lookup(id: &str) -> Result<CatalogTrack, String> {
    let source = id.strip_prefix("musicbrainz:recording:").and_then(uuid).ok_or("Invalid MusicBrainz recording ID.")?;
    let value = get(&format!("recording/{source}"), &[("inc", "artist-credits+releases+isrcs".into())]).await?;
    let track = recording(&value, None).ok_or("MusicBrainz recording metadata is incomplete.")?;
    if track.id != id { return Err("MusicBrainz returned another recording.".into()); } Ok(track)
}
pub async fn artist(id: &str) -> Result<ArtistDetails, String> {
    let source = id.strip_prefix("musicbrainz:artist:").and_then(uuid).ok_or("Invalid MusicBrainz artist ID.")?;
    let value = get(&format!("artist/{source}"), &[]).await?;
    if value["id"].as_str() != Some(&source) { return Err("MusicBrainz returned another artist.".into()); }
    let name = text(&value["name"]).ok_or("MusicBrainz artist has no name.")?;
    let rows = get("recording", &[("artist", source), ("inc", "artist-credits+releases".into()), ("limit", "50".into())]).await?;
    let tracks: Vec<_> = rows["recordings"].as_array().into_iter().flatten().filter_map(|row| recording(row, None)).filter(|track| track.artists.iter().any(|credit| credit.id.as_deref() == Some(id))).collect();
    let mut albums = Vec::new();
    for row in rows["recordings"].as_array().into_iter().flatten().filter(|row| credits(&row["artist-credit"]).iter().any(|credit| credit.id.as_deref() == Some(id))) { for album in row["releases"].as_array().into_iter().flatten().filter_map(|album| release(album, &credits(&row["artist-credit"]))) { if !albums.iter().any(|old: &CatalogAlbum| old.id == album.id) { albums.push(album); } } }
    Ok(ArtistDetails { evidence: vec![], verified_ids: vec![], info: CatalogArtist { id: id.into(), name, artwork_url: None }, top_tracks: tracks.into_iter().take(20).collect(), albums, similar_artists: vec![] })
}
pub async fn album(id: &str) -> Result<AlbumDetails, String> {
    let source = id.strip_prefix("musicbrainz:release:").and_then(uuid).ok_or("Invalid MusicBrainz release ID.")?;
    let value = get(&format!("release/{source}"), &[("inc", "recordings+artist-credits".into())]).await?;
    let info = release(&value, &[]).filter(|release| release.id == id).ok_or("MusicBrainz release identity did not match.")?;
    let mut tracks = Vec::new(); let mut partial = false;
    for medium in value["media"].as_array().into_iter().flatten() { for row in medium["tracks"].as_array().into_iter().flatten() {
        let mut value = row["recording"].clone();
        if value.get("artist-credit").is_none() { value["artist-credit"] = row.get("artist-credit").unwrap_or(&value["artist-credit"]).clone(); }
        if value.get("length").is_none() { value["length"] = row["length"].clone(); }
        match recording(&value, Some(&info)) { Some(track) => tracks.push(track), None => partial = true }
    } }
    if tracks.is_empty() { return Err("No complete recording metadata is available for this release.".into()); }
    Ok(AlbumDetails { info, tracks, partial })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn incomplete_artist_ids_do_not_erase_named_performers() {
        let rows = credits(&serde_json::json!([{"name":"Guest","artist":{"id":"invalid"}}, {"artist":{"name":"Singer"}}, {"name":" "}]));
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].name, "Guest"); assert!(rows[0].id.is_none());
        assert_eq!(rows[1].name, "Singer"); assert!(rows[1].id.is_none());
    }
    #[test]
    fn pal_pal_keeps_original_and_talwiinder_recording_identities_separate() {
        let make = |id, length, names: &[(&str, &str)]| serde_json::json!({"id":id,"title":"Pal Pal","length":length,"artist-credit":names.iter().map(|(name,id)| serde_json::json!({"name":name,"artist":{"id":id,"name":name}})).collect::<Vec<_>>()});
        let names = [("Afusic","46579862-aa41-4574-b16c-05e6d0b6dbeb"),("AliSoomroMusic","ae09b518-a8d5-4a04-93e3-373b9bc8ed60")];
        let a = recording(&make("42dfbd2f-cecb-4715-9072-a6f614c5469e",147000,&names),None).unwrap();
        let mut all = names.to_vec(); all.push(("Talwiinder","2c8c0732-7b2d-4271-978b-f893467816b8"));
        let b = recording(&make("c4197d72-b3dd-445f-bdb8-a7f6598b5f74",208000,&all),None).unwrap();
        assert!(!crate::catalog_search::same_recording(&a,&b)); assert_eq!(b.artists.len(),3);
        assert_eq!(b.artists[2].id.as_deref(),Some("musicbrainz:artist:2c8c0732-7b2d-4271-978b-f893467816b8"));
        let mut invalid = make("c4197d72-b3dd-445f-bdb8-a7f6598b5f74",208000,&all); invalid["id"]="not-a-uuid".into(); assert!(recording(&invalid,None).is_none());
    }
}
