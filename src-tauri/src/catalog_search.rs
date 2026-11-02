//! Provider composition only. Audio identity is still verified by the playback resolver.
use crate::{catalog::{self, AlbumDetails, ArtistDetails, CatalogAlbum, CatalogArtist, CatalogEntities}, itunes_metadata::{self, CatalogTrack}, lyric_identity};
use std::{collections::HashMap, sync::{Arc, Mutex, OnceLock}, time::{Duration, Instant}};

const SAAVN: &str = "https://www.jiosaavn.com/api.php";
#[derive(Clone)]
enum Value { Songs(Vec<CatalogTrack>), Entities(CatalogEntities), Artist(ArtistDetails), Album(AlbumDetails) }
type Entries = HashMap<String, (Instant, Value)>;
static CACHE: OnceLock<Mutex<Entries>> = OnceLock::new();
type Flights = HashMap<String, Arc<tokio::sync::Mutex<()>>>;
static FLIGHTS: OnceLock<Mutex<Flights>> = OnceLock::new();
fn cached(key: &str) -> Option<Value> {
    CACHE.get_or_init(|| Mutex::new(HashMap::new())).lock().unwrap_or_else(|e| e.into_inner()).get(key).filter(|(until, _)| *until > Instant::now()).map(|(_, value)| value.clone())
}
fn stale(key: &str) -> Option<Value> {
    CACHE.get_or_init(|| Mutex::new(HashMap::new())).lock().unwrap_or_else(|e| e.into_inner()).get(key).filter(|(until, _)| Instant::now().saturating_duration_since(*until) < Duration::from_secs(3600)).map(|(_, value)| value.clone())
}
fn save(key: &str, value: Value, complete: bool) {
    let mut entries = CACHE.get_or_init(|| Mutex::new(HashMap::new())).lock().unwrap_or_else(|e| e.into_inner());
    if entries.len() >= 128 { if let Some(oldest) = entries.iter().min_by_key(|(_, (until, _))| *until).map(|(key, _)| key.clone()) { entries.remove(&oldest); } }
    entries.insert(key.into(), (Instant::now() + Duration::from_secs(if complete { 600 } else { 30 }), value));
}
async fn flight(key: &str) -> tokio::sync::OwnedMutexGuard<()> {
    let lock = {
        let mut entries = FLIGHTS.get_or_init(|| Mutex::new(HashMap::new())).lock().unwrap_or_else(|e| e.into_inner());
        entries.retain(|_, value| Arc::strong_count(value) > 1);
        entries.entry(key.into()).or_insert_with(|| Arc::new(tokio::sync::Mutex::new(()))).clone()
    };
    lock.lock_owned().await
}
async fn bounded<T>(seconds: u64, future: impl std::future::Future<Output = Result<T, String>>) -> Result<T, String> {
    tokio::time::timeout(Duration::from_secs(seconds), future).await.map_err(|_| "Catalog provider timed out. Retry shortly.".to_string())?
}

fn catalog_title(title: &str) -> String {
    static COLLABORATION: OnceLock<regex::Regex> = OnceLock::new();
    COLLABORATION.get_or_init(|| regex::Regex::new(r"(?i)\s*[\[(](?:with|feat\.?|ft\.?|featuring)\s+[^\])]+[\])]").unwrap()).replace_all(title, "").into_owned()
}
fn one_edit(left: &str, right: &str) -> bool {
    if !left.is_ascii() || !right.is_ascii() || left.len() < 5 || right.len() < 5 || left.len().abs_diff(right.len()) > 1 { return false; }
    let (a,b)=(left.as_bytes(),right.as_bytes());
    let (mut i,mut j,mut edits)=(0,0,0);
    while i<a.len() && j<b.len() {
        if a[i]==b[j] { i+=1;j+=1;continue; }
        edits+=1;if edits>1 { return false; }
        if a.len()==b.len() && i+1<a.len() && a[i]==b[j+1] && a[i+1]==b[j] { i+=2;j+=2; }
        else { if a.len()>=b.len(){i+=1;} if b.len()>=a.len(){j+=1;} }
    }
    edits+usize::from(i<a.len() || j<b.len())<=1
}
pub fn relevance(query: &str, title: &str, artist: &str) -> u32 {
    let q = lyric_identity::fingerprint(query);
    if q.is_empty() { return 0; }
    let title_key = lyric_identity::fingerprint(title);
    let core = catalog_title(title);
    let artist_key = lyric_identity::fingerprint(artist);
    if q == title_key || q == lyric_identity::fingerprint(&core) { return 1000; }
    if q == lyric_identity::fingerprint(core.split(['(', '[']).next().unwrap_or(&core)) { return 950; }
    if q == artist_key || catalog::artist_names(artist).iter().any(|credit| lyric_identity::fingerprint(credit) == q) { return 900; }
    let haystack = format!("{title_key}{artist_key}");
    let terms: Vec<_> = query.split(|c: char| !c.is_alphanumeric() && !matches!(c, '\u{094d}' | '\u{0d4d}')).filter(|word| !word.is_empty() && !["and", "with", "featuring", "feat", "ft"].contains(&word.to_lowercase().as_str())).collect();
    if terms.is_empty() || terms.len()>12 { return 0; }
    if !terms.iter().all(|word| haystack.contains(&lyric_identity::fingerprint(word))) {
        let words: Vec<_> = title.split(|c:char|!c.is_alphanumeric()).chain(artist.split(|c:char|!c.is_alphanumeric())).filter(|word|!word.is_empty()).map(str::to_lowercase).collect();
        let mut corrected=0;
        for term in &terms {
            let term=term.to_lowercase();
            if words.iter().any(|word|word==&term) { continue; }
            if !words.iter().any(|word|one_edit(&term,word)) { return 0; }
            corrected+=1;
        }
        return if corrected==1 { 50 } else { 0 };
    }
    100 + if title_key.contains(&q) { 100 } else { 0 }
}
fn credits(track: &CatalogTrack) -> Vec<String> {
    let names = if track.artists.is_empty() { catalog::artist_names(&track.artist) } else { track.artists.iter().map(|credit| credit.name.clone()).collect() };
    names.iter().map(|name| lyric_identity::fingerprint(name)).filter(|name| !name.is_empty()).collect()
}
pub(crate) fn same_recording(a: &CatalogTrack, b: &CatalogTrack) -> bool {
    if a.id == b.id { return true; }
    if let (Some(left), Some(right)) = (&a.recording_metadata, &b.recording_metadata) {
        if !left.isrcs.is_empty() && !right.isrcs.is_empty() && !left.isrcs.iter().any(|code| right.isrcs.contains(code)) { return false; }
    }
    static VERSIONS: OnceLock<regex::Regex> = OnceLock::new();
    let versions = VERSIONS.get_or_init(|| regex::Regex::new(r"(?i)\b(?:live|remix|acoustic|instrumental|karaoke|cover|demo|remaster(?:ed)?|radio\s+edit|extended|sped\s+up|slowed|reprise|female|male)\b").unwrap());
    let labels = |title: &str| { let mut labels: Vec<_> = versions.find_iter(title).map(|label| label.as_str().to_lowercase()).collect(); labels.sort(); labels.dedup(); labels };
    if labels(&a.title) != labels(&b.title) { return false; }
    if let (Some(left), Some(right)) = (&a.language, &b.language) {
        if !left.trim().is_empty() && !right.trim().is_empty() && !left.trim().eq_ignore_ascii_case(right.trim()) { return false; }
    }
    if lyric_identity::title(&catalog_title(&a.title)) != lyric_identity::title(&catalog_title(&b.title)) || !a.duration.is_finite() || !b.duration.is_finite() || a.duration <= 0.0 || b.duration <= 0.0 || (a.duration - b.duration).abs() > 3.0 { return false; }
    let left = credits(a); let right = credits(b);
    !left.is_empty() && !right.is_empty() && left.iter().all(|name| right.contains(name)) && right.iter().all(|name| left.contains(name))
}
fn usable(query: &str, track: &CatalogTrack) -> bool {
    let artist = track.artist.to_lowercase();
    static VERSIONS: OnceLock<regex::Regex> = OnceLock::new();
    let versions = VERSIONS.get_or_init(|| regex::Regex::new(r"(?i)\b(?:lo[\s\p{Pd}]*fi|mashup|cover|karaoke|slowed|sped[\s\p{Pd}]*up|nightcore|ringtone)\b").unwrap());
    !["original sound", "unknown artist", "ringtone"].iter().any(|label| artist.contains(label)) && !versions.find_iter(&track.title).any(|version| !lyric_identity::fingerprint(query).contains(&lyric_identity::fingerprint(version.as_str())))
}
pub(crate) fn merge_songs(query: &str, primary: Vec<CatalogTrack>, secondary: Vec<CatalogTrack>, limit: usize) -> Vec<CatalogTrack> {
    rank_songs(query, primary, secondary, limit, true)
}
fn rank_songs(query: &str, primary: Vec<CatalogTrack>, secondary: Vec<CatalogTrack>, limit: usize, deduplicate: bool) -> Vec<CatalogTrack> {
    let rank = |tracks: Vec<CatalogTrack>| tracks.into_iter().enumerate().map(|(index, track)| {
        let keyword = relevance(query, &track.title, &track.artist);
        let keyword_score = keyword * 1000;
        // Apple exposes no play counts; preserve provider rank and use neutral missing popularity.
        let popularity = track.play_count.map(|count| ((count as f64).ln_1p() * 8.0).min(160.0) as u32).unwrap_or(80);
        let provider_rank = 100u32.saturating_sub(index as u32 * 3);
        (track, keyword, keyword_score + popularity + provider_rank)
    });
    let mut result: Vec<(CatalogTrack, u32)> = Vec::new();
    for (track, keyword, score) in rank(primary).chain(rank(secondary)).filter(|(track, keyword, _)| usable(query, track) && *keyword > 0) {
        let _ = keyword;
        // Keep a provider's distinct release visible instead of replacing it with another provider's compilation.
        if let Some((old, old_score)) = result.iter_mut().find(|(old, _)| deduplicate && same_recording(old, &track)
            && (old.id.split(':').next() == track.id.split(':').next()
                || lyric_identity::fingerprint(&old.album) == lyric_identity::fingerprint(&track.album))) {
            *old_score = (*old_score).max(score);
            if old.artwork_url.is_none() { old.artwork_url = track.artwork_url; }
            if old.language.as_ref().is_none_or(|value| value.trim().is_empty()) { old.language = track.language; }
            if old.genre.as_ref().is_none_or(|value| value.trim().is_empty()) { old.genre = track.genre; }
        } else { result.push((track, score)); }
    }
    result.sort_by_key(|(_, score)| std::cmp::Reverse(*score));
    result.into_iter().take(limit).map(|(track, _)| track).collect()
}
pub async fn search(query: &str, limit: usize) -> Result<Vec<CatalogTrack>, String> {
    search_results(query, limit, false).await
}
pub async fn search_records(query: &str, limit: usize) -> Result<Vec<CatalogTrack>, String> {
    search_results(query, limit, true).await
}
async fn search_results(query: &str, limit: usize, retain_records: bool) -> Result<Vec<CatalogTrack>, String> {
    let key = format!("{}:{}", if retain_records { "song-records" } else { "songs" }, query.trim().to_lowercase());
    let _guard = flight(&key).await;
    if let Some(Value::Songs(mut rows)) = cached(&key) { rows.truncate(limit); return Ok(rows); }
    let (saavn, apple, brainz) = tokio::join!(bounded(6, catalog::search_from(SAAVN, query, 30)), bounded(10, itunes_metadata::search_catalog(query.into(), Some(60))), bounded(4, crate::brainz_catalog::search(query)));
    if saavn.is_err() && apple.is_err() && brainz.is_err() {
        if let Some(Value::Songs(mut rows)) = stale(&key) { rows.truncate(limit); return Ok(rows); }
        return Err("Both catalog providers are unavailable. Direct YouTube search is still separate; retry the catalog shortly.".into());
    }
    let complete = saavn.is_ok() && apple.is_ok() && brainz.is_ok();
    let merge = |a,b| if retain_records { rank_songs(query,a,b,60,false) } else { merge_songs(query,a,b,60) };
    let rows = merge(saavn.unwrap_or_default(), apple.unwrap_or_default());
    let mut rows = merge(rows, brainz.unwrap_or_default());
    save(&key, Value::Songs(rows.clone()), complete && !rows.is_empty());
    rows.truncate(limit); Ok(rows)
}
fn same_album(a: &CatalogAlbum, b: &CatalogAlbum) -> bool {
    a.id == b.id || (crate::music_metadata::album_title(&a.title).to_lowercase() == crate::music_metadata::album_title(&b.title).to_lowercase() && lyric_identity::artists_match(&a.artist, &b.artist) && (a.year.is_none() || b.year.is_none() || a.year == b.year))
}
fn merge_albums(primary: Vec<CatalogAlbum>, secondary: Vec<CatalogAlbum>) -> Vec<CatalogAlbum> {
    let mut rows = primary;
    for album in secondary { if !rows.iter().any(|old| same_album(old, &album)) { rows.push(album); } }
    rows
}
fn credited_artists(candidates: Vec<CatalogArtist>, mut credited: Vec<CatalogArtist>) -> Vec<CatalogArtist> {
    // Artist search also returns empty publishing entities; require a performing credit on a returned song.
    for artist in &mut credited {
        if artist.artwork_url.is_none() {
            artist.artwork_url = candidates.iter().find(|candidate| candidate.id == artist.id).and_then(|candidate| candidate.artwork_url.clone());
        }
    }
    let mut seen=std::collections::HashSet::new();
    credited.retain(|artist|catalog::valid_artist_id(&artist.id)&&seen.insert(artist.id.clone()));
    credited
}

fn recordings(profile: &ArtistDetails) -> &[CatalogTrack] {
    if profile.evidence.is_empty() { &profile.top_tracks } else { &profile.evidence }
}

fn artist_overlap(a: &ArtistDetails, b: &ArtistDetails) -> bool {
    let owned = |track: &CatalogTrack, id: &str| track.artists.iter().any(|credit| credit.id.as_deref()==Some(id));
    let mut matches: Vec<&CatalogTrack> = vec![];
    let mut other_releases=std::collections::HashSet::new();
    for track in recordings(a).iter().filter(|track|owned(track,&a.info.id)) {
        if matches.iter().any(|old|same_recording(old,track)){continue;}
        if let Some(other)=recordings(b).iter().filter(|other|owned(other,&b.info.id)).find(|other|same_recording(track,other)) {
            matches.push(track);
            if let Some(id)=&other.album_id{other_releases.insert(id);}
        }
    }
    let releases: std::collections::HashSet<_> = matches.iter().filter_map(|track|track.album_id.as_ref()).collect();
    let solo=matches.iter().filter(|track|track.artists.len()==1).count();
    let collaborators: std::collections::HashSet<_>=matches.iter().filter(|track|track.artists.len()>1).map(|track|{let mut names=credits(track);names.sort();names}).collect();
    // Independent releases and multiple credit contexts corroborate recording overlap; names alone never qualify.
    matches.len()>=3 && releases.len()>=3 && other_releases.len()>=3 && (solo>=2 || collaborators.len()>=2)
}

fn unify_artists(artists: &mut Vec<CatalogArtist>, proofs: &[ArtistDetails]) {
    for apple in proofs.iter().filter(|row|row.info.id.starts_with("itunes:")) {
        let candidates: Vec<_>=proofs.iter().filter(|row|row.info.id.starts_with("saavn:")&&catalog::same_name(&row.info.name,&apple.info.name)&&artist_overlap(row,apple)).collect();
        if candidates.len()!=1 {continue;}
        let saavn=candidates[0];
        if proofs.iter().filter(|row|row.info.id.starts_with("itunes:")&&catalog::same_name(&row.info.name,&saavn.info.name)&&artist_overlap(saavn,row)).count()!=1 {continue;}
        let mut merged=saavn.clone();
        merged.verified_ids=vec![saavn.info.id.clone(),apple.info.id.clone()];
        if merged.info.artwork_url.is_none(){merged.info.artwork_url=apple.info.artwork_url.clone();}
        // Keep every release/recording ID and its original credits, including collaborations.
        merged.top_tracks = recordings(saavn).to_vec();
        for track in recordings(apple) {if !merged.top_tracks.iter().any(|old|old.id==track.id){merged.top_tracks.push(track.clone());}}
        for album in &apple.albums {if !merged.albums.iter().any(|old|old.id==album.id){merged.albums.push(album.clone());}}
        for id in &merged.verified_ids {save(&format!("artist:{id}"),Value::Artist(merged.clone()),true);}
        artists.retain(|row|row.id!=apple.info.id);
    }
}

fn mapped_artist_cards(artists: &mut Vec<CatalogArtist>) {
    for artist in artists.iter_mut() {
        if let Some(Value::Artist(profile))=cached(&format!("artist:{}",artist.id)) {
            if profile.verified_ids.contains(&artist.id){*artist=profile.info;}
        }
    }
    let mut seen=std::collections::HashSet::new();
    artists.retain(|artist|seen.insert(artist.id.clone()));
}

fn verification_candidates(artists: &[CatalogArtist]) -> Vec<CatalogArtist> {
    let mut selected = Vec::new();
    let mut pairs = 0;
    let mut names = std::collections::HashSet::new();
    for artist in artists {
        if !names.insert(lyric_identity::fingerprint(&artist.name)) { continue; }
        let group: Vec<_> = artists.iter().filter(|row| catalog::same_name(&row.name, &artist.name)).collect();
        let saavn = group.iter().filter(|row| row.id.starts_with("saavn:artist:")).count();
        let apple = group.iter().filter(|row| row.id.starts_with("itunes:")).count();
        let count = saavn * apple;
        // Skipping a whole ambiguous group is safer than proving only its first few pairs.
        if count == 0 || pairs + count > 3 { continue; }
        pairs += count;
        selected.extend(group.into_iter().filter(|row| row.id.starts_with("saavn:artist:") || row.id.starts_with("itunes:")).cloned());
    }
    selected
}

fn verification_requests() -> &'static tokio::sync::Semaphore {
    static REQUESTS: OnceLock<tokio::sync::Semaphore> = OnceLock::new();
    REQUESTS.get_or_init(|| tokio::sync::Semaphore::new(2))
}

fn evidence_albums(profile: &ArtistDetails, proofs: &[ArtistDetails]) -> Vec<CatalogAlbum> {
    let mut albums = profile.albums.clone();
    let key = |value: &str| lyric_identity::fingerprint(&crate::music_metadata::album_title(value));
    // Spend the three lookups on releases represented in the other provider's evidence.
    // This chooses evidence to inspect; it never establishes recording or artist identity.
    albums.sort_by_key(|album| std::cmp::Reverse(proofs.iter().filter(|other| other.info.id.starts_with("itunes:")).flat_map(recordings).filter(|track| {
        let year = track.recording_metadata.as_ref().and_then(|metadata| metadata.release_date.as_deref()).and_then(|date|date.get(..4)).and_then(|year|year.parse::<u32>().ok());
        let compatible_year = album.year.zip(year).is_none_or(|(left,right)|left.abs_diff(right)<=1);
        compatible_year && (key(&track.album) == key(&album.title) || lyric_identity::title(&track.title) == lyric_identity::title(&album.title))
    }).count()));
    albums.truncate(3);
    albums
}

async fn artist_proof(id: &str) -> Result<ArtistDetails, String> {
    let key = format!("artist-proof:{id}");
    let _guard = flight(&key).await;
    if let Some(Value::Artist(value)) = cached(&key) { return Ok(value); }
    let _permit = verification_requests().acquire().await.map_err(|e| e.to_string())?;
    let value = if id.starts_with("itunes:") { itunes_metadata::lookup_artist(id.into()).await }
        else { catalog::lookup_saavn_artist(SAAVN, id).await }?;
    if value.info.id != id { return Err("Provider returned a different artist identity.".into()); }
    save(&key, Value::Artist(value.clone()), true);
    Ok(value)
}

pub(crate) async fn resolve_artists(query: &str, artists: &[CatalogArtist]) -> Vec<ArtistDetails> {
    resolve_artists_until(query, artists, tokio::time::Instant::now() + Duration::from_secs(12)).await
}

async fn resolve_artists_until(query: &str, artists: &[CatalogArtist], deadline: tokio::time::Instant) -> Vec<ArtistDetails> {
    let key = format!("artist-resolution:{}:{}", query.trim().to_lowercase(), artists.iter().map(|row| row.id.as_str()).collect::<Vec<_>>().join(","));
    let Ok(_guard) = tokio::time::timeout_at(deadline, flight(&key)).await else { return vec![]; };
    if cached(&key).is_some() {
        return artists.iter().filter_map(|row| match cached(&format!("artist:{}",row.id)) { Some(Value::Artist(profile)) if profile.verified_ids.first()==Some(&row.id) => Some(profile), _ => None }).collect();
    }
    let candidates = verification_candidates(artists);
    let work = async {
        let mut checks = tokio::task::JoinSet::new();
        for candidate in &candidates {
            let id = candidate.id.clone();
            checks.spawn(async move { artist_proof(&id).await });
        }
        let mut proofs = Vec::new();
        while let Some(result) = checks.join_next().await {
            // A missing candidate could be the other half of an ambiguous identity.
            proofs.push(result.map_err(|e|e.to_string())??);
        }
        for index in 0..proofs.len() {
            if !proofs[index].info.id.starts_with("saavn:") || proofs.iter().any(|other|other.info.id.starts_with("itunes:") && artist_overlap(&proofs[index],other)) { continue; }
            let id = proofs[index].info.id.clone();
            for release in evidence_albums(&proofs[index], &proofs) {
                let _permit = verification_requests().acquire().await.map_err(|e|e.to_string())?;
                let album = album(&release.id).await?;
                for track in album.tracks.into_iter().filter(|track|track.artists.iter().any(|credit|credit.id.as_deref()==Some(&id))) {
                    let evidence = &mut proofs[index].evidence;
                    if evidence.len()<100 && !evidence.iter().any(|old|same_recording(old,&track)) { evidence.push(track); }
                }
            }
            save(&format!("artist-proof:{id}"),Value::Artist(proofs[index].clone()),true);
        }
        let mut cards = candidates.clone();
        unify_artists(&mut cards,&proofs);
        Ok::<_, String>(())
    };
    let complete = matches!(tokio::time::timeout_at(deadline,work).await, Ok(Ok(())));
    save(&key,Value::Entities(CatalogEntities{artists:vec![],albums:vec![],warning:None}),complete);
    artists.iter().filter_map(|row|match cached(&format!("artist:{}",row.id)){Some(Value::Artist(profile)) if profile.verified_ids.first()==Some(&row.id)=>Some(profile),_=>None}).collect()
}

pub async fn entities(query: &str) -> Result<CatalogEntities, String> {
    let key = format!("entities:{}", query.trim().to_lowercase()); let _guard = flight(&key).await;
    if let Some(Value::Entities(mut rows)) = cached(&key) { mapped_artist_cards(&mut rows.artists); return Ok(rows); }
    let (saavn, apple, tracks) = tokio::join!(bounded(6, catalog::search_entities_from(SAAVN, query)), bounded(11, itunes_metadata::search_entities(query)), bounded(11, search(query, 60)));
    if saavn.is_err() && apple.is_err() {
        if let Some(Value::Entities(mut rows)) = stale(&key) { rows.warning = Some("Providers could not refresh. Showing cached catalog results.".into()); return Ok(rows); }
        return Err("Artist and album providers are temporarily unavailable.".into());
    }
    let complete = saavn.is_ok() && apple.is_ok();
    let empty = || CatalogEntities { artists: vec![], albums: vec![], warning: None };
    let mut primary = saavn.unwrap_or_else(|_| empty()); let mut secondary = apple.unwrap_or_else(|_| empty());
    secondary.artists.extend(itunes_metadata::entities_from_tracks(query, tracks.unwrap_or_default()).artists);
    // Raw artist search includes collaboration/publishing entities without performing credits.
    // Keep those as portrait candidates only; cards must come from actual recording credits.
    primary.artists = credited_artists(primary.artists, secondary.artists.clone());
    mapped_artist_cards(&mut primary.artists);
    primary.artists.sort_by_key(|artist| (std::cmp::Reverse(relevance(query, &artist.name, "")),!artist.id.starts_with("saavn:")));
    primary.albums.retain(|album| relevance(query, &album.title, &album.artist) > 0);
    primary.albums = merge_albums(primary.albums, secondary.albums);
    primary.albums.sort_by_key(|album| std::cmp::Reverse(relevance(query, &album.title, &album.artist))); primary.albums.truncate(6);
    if !complete { primary.warning = Some("Some catalog providers could not refresh. Showing verified available results.".into()); }
    save(&key, Value::Entities(primary.clone()), complete); Ok(primary)
}
pub async fn artist(id: &str) -> Result<ArtistDetails, String> {
    if !catalog::valid_artist_id(id) { return Err("Artist identity is unresolved. Search and select a provider artist result.".into()); }
    let key = format!("artist:{id}"); let _guard = flight(&key).await;
    if let Some(Value::Artist(value)) = cached(&key) { if value.info.id == id || value.verified_ids.iter().any(|alias|alias==id) { return Ok(value); } }
    let primary = if id.starts_with("musicbrainz:") { bounded(12, crate::brainz_catalog::artist(id)).await } else if id.starts_with("itunes:") { bounded(12, itunes_metadata::lookup_artist(id.into())).await } else { bounded(6, catalog::lookup_saavn_artist(SAAVN, id)).await };
    let value = match primary {
        Ok(value) => value,
        Err(error) => match stale(&key) { Some(Value::Artist(value)) if value.info.id == id || value.verified_ids.iter().any(|alias|alias==id) => return Ok(value), _ => return Err(error) },
    };
    if value.info.id != id { return Err("Provider returned a different artist identity.".into()); }
    // The same evidence path serves direct credits as well as discovery; a failed proof leaves the original identity intact.
    if let Ok(rows)=entities(&value.info.name).await { if rows.warning.is_none() { let _=resolve_artists(&value.info.name,&rows.artists).await; } }
    if let Some(Value::Artist(merged))=cached(&key) {if merged.verified_ids.iter().any(|alias|alias==id){return Ok(merged);}}
    save(&key, Value::Artist(value.clone()), true); Ok(value)
}
pub async fn album(id: &str) -> Result<AlbumDetails, String> {
    let key = format!("album:{id}"); let _guard = flight(&key).await;
    if let Some(Value::Album(value)) = cached(&key) { if value.info.id == id || id.starts_with("saavn:album:search:") { return Ok(value); } }
    let primary = if id.starts_with("musicbrainz:") { bounded(12, crate::brainz_catalog::album(id)).await } else if id.starts_with("itunes:") { bounded(12, itunes_metadata::lookup_album(id.into())).await } else { bounded(6, catalog::lookup_saavn_album(SAAVN, id)).await };
    let value = match primary {
        Ok(value) => value,
        Err(error) => match stale(&key) { Some(Value::Album(value)) if value.info.id == id => return Ok(value), _ => return Err(error) },
    };
    if !id.starts_with("saavn:album:search:") && value.info.id != id { return Err("Provider returned a different album identity.".into()); }
    save(&key, Value::Album(value.clone()), !value.partial); Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn captured_seven_cards_require_recording_credits_and_reissue_aware_album_selection() {
        let fixture:serde_json::Value=serde_json::from_str(include_str!("../../tests/fixtures/artist-anirudh-live.json")).unwrap();
        let artist=|row:&serde_json::Value| CatalogArtist{id:row["id"].as_str().unwrap().into(),name:row["name"].as_str().unwrap().into(),artwork_url:row["artworkUrl"].as_str().map(str::to_owned)};
        let candidates:Vec<_>=fixture["search"]["artists"].as_array().unwrap().iter().map(artist).collect();
        assert_eq!(candidates.len(),7);
        let cards=credited_artists(candidates.clone(),vec![candidates[0].clone(),candidates[1].clone()]);
        assert_eq!(cards.len(),2);
        let profiles:Vec<_>=fixture["profiles"].as_array().unwrap().iter().map(|profile| {
            let evidence=profile["evidence"].as_array().unwrap().iter().map(|row| {
                let mut track=song(row["id"].as_str().unwrap(),row["title"].as_str().unwrap(),row["artist"].as_str().unwrap(),row["duration"].as_f64().unwrap());
                track.album=row["album"].as_str().unwrap().into(); track.album_id=row["albumId"].as_str().map(str::to_owned);
                track.language=row["language"].as_str().map(str::to_owned);
                track.artists=row["artists"].as_array().unwrap().iter().map(|credit|itunes_metadata::CatalogArtistCredit{name:credit["name"].as_str().unwrap().into(),id:credit["id"].as_str().map(str::to_owned)}).collect();
                track.recording_metadata=serde_json::from_value(row["recordingMetadata"].clone()).ok(); track
            }).collect();
            let albums=profile["albums"].as_array().unwrap().iter().map(|row|CatalogAlbum{id:row["id"].as_str().unwrap().into(),title:row["title"].as_str().unwrap().into(),artist:String::new(),artists:vec![],artwork_url:None,year:row["year"].as_u64().map(|year|year as u32),track_count:None}).collect();
            ArtistDetails{evidence,verified_ids:vec![],info:artist(&profile["info"]),top_tracks:vec![],albums,similar_artists:vec![]}
        }).collect();
        let selected=evidence_albums(&profiles[0],&profiles);
        assert_eq!(selected.len(),3);
        assert!(selected.iter().any(|album|album.title=="3"));
        assert!(!selected.iter().any(|album|album.title=="Ethir Neechal"));
        assert!(artist_overlap(&profiles[0],&profiles[1]));
    }
    #[test]
    #[ignore = "live provider artist regression"]
    fn live_anirudh_search_resolution() {
        tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap().block_on(async {
            let rows=entities("Anirudh Ravichander").await.unwrap();
            println!("CARDS {}",serde_json::to_string(&rows).unwrap());
            let resolved=resolve_artists("Anirudh Ravichander",&rows.artists).await;
            println!("RESOLVED {}",resolved.len());
            assert_eq!(rows.artists.len(),2,"only credited artist identities belong in the initial search");
            assert_eq!(resolved.len(),1,"broader evidence must confirm the live identity");
            for id in &resolved[0].verified_ids { assert_eq!(artist(id).await.unwrap().info.id,resolved[0].info.id); }
            for id in ["saavn:artist:455663","itunes:480976476"] {
                let proof=artist_proof(id).await.unwrap();
                println!("PROOF {id} {}",serde_json::json!({"info":proof.info,"evidence":proof.evidence,"albums":proof.albums}));
            }
        });
    }
    fn anirudh_profiles() -> (ArtistDetails, ArtistDetails) {
        let fixture: serde_json::Value = serde_json::from_str(include_str!("../../tests/fixtures/artist-anirudh.json")).unwrap();
        let make = |provider: &str, top: &str| {
            let id = fixture[provider].as_str().unwrap();
            let name = fixture["name"].as_str().unwrap();
            let rows = |titles: Vec<(String, String, f64, String)>| titles.into_iter().enumerate().map(|(n,(title,release,duration,credits))| {
                let mut row = song(&format!("{id}:record:{n}"), &title, &credits, duration);
                row.album = release; row.album_id = Some(format!("{id}:release:{n}"));
                row.artists[0].id = Some(id.into()); row
            }).collect::<Vec<_>>();
            let top_tracks = rows(fixture[top].as_array().unwrap().iter().map(|title|(title.as_str().unwrap().into(),title.as_str().unwrap().into(),180.0,name.into())).collect());
            let mut evidence = top_tracks.clone();
            let shared = rows(fixture["shared"].as_array().unwrap().iter().map(|track| {
                let mut credits = vec![name];
                credits.extend(track["guests"].as_array().unwrap().iter().map(|guest|guest.as_str().unwrap()));
                (track["title"].as_str().unwrap().into(),track["release"].as_str().unwrap().into(),track["duration"].as_f64().unwrap(),credits.join(", "))
            }).collect());
            for mut row in shared { row.id.push_str(":shared"); evidence.push(row); }
            ArtistDetails { evidence, verified_ids:vec![], info:CatalogArtist{id:id.into(),name:name.into(),artwork_url:Some(format!("{provider}-portrait"))}, top_tracks, albums:vec![], similar_artists:vec![] }
        };
        (make("saavn","saavnTopTen"),make("apple","appleTopTen"))
    }

    #[test]
    fn broader_anirudh_evidence_resolves_old_links_and_cached_searches() {
        tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap().block_on(async {
            let (saavn,apple)=anirudh_profiles();
            let mut narrow_a=saavn.clone(); narrow_a.evidence.clear();
            let mut narrow_b=apple.clone(); narrow_b.evidence.clear();
            assert!(!artist_overlap(&narrow_a,&narrow_b));
            assert!(artist_overlap(&saavn,&apple));
            for profile in [&saavn,&apple] { save(&format!("artist-proof:{}",profile.info.id),Value::Artist(profile.clone()),true); }
            let cards=vec![saavn.info.clone(),apple.info.clone()];
            let resolved=resolve_artists("fixture Anirudh",&cards).await;
            assert_eq!(resolved.len(),1); assert_eq!(resolved[0].info.id,saavn.info.id);
            assert_eq!(resolved[0].info.artwork_url,saavn.info.artwork_url);
            assert_eq!(resolved[0].top_tracks.len(),26);
            for id in [&saavn.info.id,&apple.info.id] {
                let profile=artist(id).await.unwrap();
                assert_eq!(profile.verified_ids.len(),2); assert_eq!(profile.info.id,saavn.info.id);
            }
            assert_eq!(resolve_artists("fixture Anirudh",&cards).await.len(),1);
        });
    }

    #[test]
    fn album_fallback_uses_only_candidate_credits_and_at_most_three_releases() {
        tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap().block_on(async {
            let (mut saavn,mut apple)=anirudh_profiles();
            saavn.info.id="saavn:artist:88000001".into(); apple.info.id="itunes:88000002".into();
            for row in &mut saavn.evidence { row.artists[0].id=Some(saavn.info.id.clone()); }
            for row in &mut apple.evidence { row.artists[0].id=Some(apple.info.id.clone()); }
            let shared=saavn.evidence.split_off(10);
            for (n,track) in shared.into_iter().enumerate() {
                let info=CatalogAlbum{id:format!("saavn:album:8800000{n}"),title:track.album.clone(),artist:saavn.info.name.clone(),artists:track.artists.clone(),artwork_url:None,year:None,track_count:Some(2)};
                saavn.albums.push(info.clone());
                let mut uncredited=track.clone(); uncredited.id.push_str(":uncredited"); uncredited.artists[0].id=Some("saavn:artist:9".into());
                save(&format!("album:{}",info.id),Value::Album(AlbumDetails{info,tracks:vec![uncredited,track],partial:false}),true);
            }
            let mut fourth=saavn.albums[0].clone(); fourth.id="saavn:album:88000009".into(); saavn.albums.push(fourth);
            for profile in [&saavn,&apple] { save(&format!("artist-proof:{}",profile.info.id),Value::Artist(profile.clone()),true); }
            let cards=vec![saavn.info.clone(),apple.info.clone()];
            let resolved=resolve_artists("album fallback fixture",&cards).await;
            assert_eq!(resolved.len(),1);
            let Some(Value::Artist(proof))=cached(&format!("artist-proof:{}",saavn.info.id)) else { panic!("missing proof"); };
            assert_eq!(proof.evidence.len(),13);
            assert!(proof.evidence.iter().all(|track|track.artists[0].id.as_ref()==Some(&saavn.info.id)));
        });
    }

    #[test]
    fn evidence_rejects_namesakes_repeats_collaboration_entities_and_ambiguity() {
        let (saavn,apple)=anirudh_profiles();
        for kind in ["namesake","repeat","collaboration","insufficient","uncredited"] {
            let mut other=apple.clone();
            match kind {
                "namesake" => for row in &mut other.evidence { row.title.push_str(" other"); },
                "repeat" => for row in &mut other.evidence { row.album_id=Some("same-release".into()); },
                "collaboration" => {
                    for row in &mut other.evidence { row.artists.push(itunes_metadata::CatalogArtistCredit{id:None,name:"Permanent collaborator".into()}); }
                },
                "insufficient" => { other.evidence.pop(); },
                _ => for row in &mut other.evidence { row.artists[0].id=None; },
            }
            assert!(!artist_overlap(&saavn,&other),"{kind}");
        }
        let mut duplicate=apple.clone(); duplicate.info.id="itunes:99900001".into();
        for row in &mut duplicate.evidence { row.artists[0].id=Some(duplicate.info.id.clone()); }
        let mut cards=vec![saavn.info.clone(),apple.info.clone(),duplicate.info.clone()];
        unify_artists(&mut cards,&[saavn,apple,duplicate]); assert_eq!(cards.len(),3);
    }

    #[test]
    fn pair_budget_skips_incomplete_ambiguity_groups_and_deadline_cancels_pending_requests() {
        tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap().block_on(async {
            let make=|id:&str|CatalogArtist{id:id.into(),name:"Timeout fixture".into(),artwork_url:None};
            let mut cards=vec![make("saavn:artist:99000001"),make("itunes:99000002")];
            assert_eq!(verification_candidates(&cards).len(),2);
            cards.extend([make("itunes:99000003"),make("itunes:99000004")]);
            assert_eq!(verification_candidates(&cards).len(),4);
            cards.push(make("itunes:99000005"));
            assert!(verification_candidates(&cards).is_empty());
            cards.truncate(2);
            let permits=verification_requests().acquire_many(2).await.unwrap();
            let deadline=tokio::time::Instant::now()+Duration::from_millis(10);
            assert!(resolve_artists_until("timeout fixture",&cards,deadline).await.is_empty());
            drop(permits);
            // Failed verification is cached briefly and cannot turn a retry into an identity guess.
            assert!(resolve_artists("timeout fixture",&cards).await.is_empty());
            assert!(cached("artist:itunes:99000002").is_none());
        });
    }
    #[test]
    fn interactive_records_preserve_original_provider_rows_and_metadata() {
        let a=song("saavn:abcdefgh","Evening Song","Gini",180.0);
        let mut b=song("itunes:42","Evening Song","Gini",180.0);b.artwork_url=Some("apple-cover".into());
        assert_eq!(merge_songs("Evening Song",vec![a.clone()],vec![b.clone()],60).len(),1);
        let rows=rank_songs("Evening Song",vec![a],vec![b],60,false);
        assert_eq!(rows.len(),2);
        assert_eq!(rows[0].id,"saavn:abcdefgh");assert!(rows[0].artwork_url.is_none());
        assert_eq!(rows[1].id,"itunes:42");assert_eq!(rows[1].artwork_url.as_deref(),Some("apple-cover"));
    }
    #[test]
    fn interactive_record_cache_cannot_reuse_the_lossy_legacy_cache() {
        let a=song("saavn:abcdefgh","Cache control","Gini",180.0);
        let b=song("itunes:42","Cache control","Gini",180.0);
        save("songs:phase3-cache",Value::Songs(vec![a.clone()]),true);
        save("song-records:phase3-cache",Value::Songs(vec![a,b]),true);
        tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap().block_on(async {
            assert_eq!(search("phase3-cache",60).await.unwrap().len(),1);
            assert_eq!(search_records("phase3-cache",60).await.unwrap().len(),2);
            for query in ["", "\0bad"] { assert!(catalog::search_catalog_records(query.into(),None).await.is_err()); }
        });
    }
    #[test]
    fn verified_artist_mapping_requires_independent_releases_and_credit_contexts() {
        let make=|id: &str| ArtistDetails{evidence:vec![],verified_ids:vec![],info:CatalogArtist{id:id.into(),name:"Same name".into(),artwork_url:None},top_tracks:(0..3).map(|n|{let mut row=song(&format!("{id}:{n}"),&format!("Song {n}"),"Same name",180.0);row.album_id=Some(format!("{id}:album:{n}"));row.artists[0].id=Some(id.into());row}).collect(),albums:vec![],similar_artists:vec![]};
        let a=make("saavn:artist:1");let b=make("itunes:2");
        assert!(artist_overlap(&a,&b));
        let mut sparse=b.clone();sparse.top_tracks.truncate(1);assert!(!artist_overlap(&a,&sparse));
        let mut conflict=b.clone();conflict.top_tracks[0].title.push_str(" (Live)");assert!(!artist_overlap(&a,&conflict));
        let mut compilation=b.clone();for row in &mut compilation.top_tracks{row.album_id=Some("one-release".into());}assert!(!artist_overlap(&compilation,&a));
        let mut unrelated=b.clone();for row in &mut unrelated.top_tracks{row.title.push_str(" other");}assert!(!artist_overlap(&a,&unrelated));
        let mut missing=b.clone();for row in &mut missing.top_tracks{row.album_id=None;}assert!(!artist_overlap(&a,&missing));
        let mut uncredited=b.clone();for row in &mut uncredited.top_tracks{row.artists[0].id=None;}assert!(!artist_overlap(&a,&uncredited));
        let mut rows=vec![a.info.clone(),b.info.clone()];unify_artists(&mut rows,&[a.clone(),b.clone(),make("saavn:artist:3")]);assert_eq!(rows.len(),2);
        unify_artists(&mut rows,&[a.clone(),b.clone()]);assert_eq!(rows.len(),1);
        let mut other_query=vec![a.info,b.info];mapped_artist_cards(&mut other_query);assert_eq!(other_query.len(),1);assert_eq!(other_query[0].id,"saavn:artist:1");
    }

    #[test]
    #[ignore = "explicit live identity verification"]
    fn live_artist_equivalence() {
        tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap().block_on(async {
            for query in ["Gini","Sai Abhyankkar"] {
                let rows=entities(query).await.unwrap();println!("{query}: {}",serde_json::to_string(&rows).unwrap());
                let chosen=rows.artists.iter().find(|row|row.id.starts_with("saavn:")&&catalog::same_name(&row.name,query)&&row.artwork_url.is_some()).unwrap();
                let details=artist(&chosen.id).await.unwrap();println!("PROFILE {}",serde_json::to_string(&details).unwrap());
                assert_eq!(details.verified_ids.len(),2,"{query} must have corroborated mapping");
                for id in &details.verified_ids{assert_eq!(artist(id).await.unwrap().info.id,chosen.id);}
                if query=="Gini"{assert!(!details.verified_ids.iter().any(|id|id=="saavn:artist:1249318"));}
            }
        });
    }
    fn song(id: &str, title: &str, artist: &str, duration: f64) -> CatalogTrack {
        CatalogTrack { recording_metadata: None, play_count: None, id: id.into(), title: title.into(), artist: artist.into(), artists: catalog::artist_names(artist).into_iter().map(|name| itunes_metadata::CatalogArtistCredit { name, id: None }).collect(), artist_id: None, album: "Release".into(), album_id: None, duration, artwork_url: None, genre: None, language: None }
    }
    #[test]
    fn lexical_recovery_is_bounded_and_preserves_intent() {
        assert_eq!(relevance("kesaryia", "Kesariya", "Arijit Singh"),50);
        assert_eq!(relevance("kesariy", "Kesariya", "Arijit Singh"),200);
        assert_eq!(relevance("cat", "Car", "Singer"),0);
        assert_eq!(relevance("kesaryia wrong", "Kesariya", "Arijit Singh"),0);
        let rows=merge_songs("Kesariya",vec![song("saavn:1","Other","Kesariya",180.0)],vec![song("itunes:1","Kesariya","Arijit Singh",180.0)],20);
        assert_eq!(rows[0].title,"Kesariya");
    }
    #[test]
    fn metadata_merge_preserves_versions_complete_credits_languages_and_existing_values() {
        let base = song("saavn:abcd1234", "Evening Song", "Singer & Guest", 180.0);
        for (title, artist, language) in [
            ("Evening Song", "Singer & Other", None),
            ("Evening Song", "Singer", None),
            ("Evening Song (feat. Guest) [Live]", "Singer & Guest", None),
            ("Evening Song (Female Version)", "Singer & Guest", None),
            ("Evening Song", "Singer & Guest", Some("telugu")),
        ] {
            let mut original = base.clone(); original.language = Some("tamil".into());
            let mut other = song("itunes:2", title, artist, 180.0); other.language = language.map(str::to_owned);
            assert!(!same_recording(&original, &other), "{title}: {artist}");
        }
        let mut extra = song("itunes:2", "Evening Song", "Guest & Singer", 181.0);
        let mut identified = base.clone();
        identified.recording_metadata = crate::recording_metadata::from_provider(identified.id.clone(), &serde_json::json!("USABC2412345"), None, &serde_json::Value::Null);
        extra.recording_metadata = crate::recording_metadata::from_provider(extra.id.clone(), &serde_json::json!("USABC2499999"), None, &serde_json::Value::Null);
        assert!(!same_recording(&identified,&extra));
        extra.recording_metadata = None;
        extra.language = Some("tamil".into()); extra.genre = Some("Pop".into());
        let rows = merge_songs("Evening Song", vec![base.clone()], vec![extra.clone()], 20);
        assert_eq!(rows.len(), 1); assert_eq!(rows[0].id, base.id);
        assert_eq!(rows[0].language.as_deref(), Some("tamil"));
        assert_eq!(rows[0].genre.as_deref(), Some("Pop"));
        assert_eq!(rows[0].duration, 180.0); assert_eq!(rows[0].artist, base.artist);
        let mut original = base; original.genre = Some("User genre".into());
        assert_eq!(merge_songs("Evening Song", vec![original], vec![extra], 20)[0].genre.as_deref(), Some("User genre"));
    }

    #[test]
    fn artist_results_require_song_credits_and_preserve_provider_identity() {
        let artist = |id: &str, name: &str| CatalogArtist { id: id.into(), name: name.into(), artwork_url: Some("https://c.saavncdn.com/artist.jpg".into()) };
        let candidates = vec![artist("saavn:artist:4481068", "Hola Amigos"), artist("saavn:artist:13345690", "Jackie Young Music/Hola Amigo Songs"), artist("saavn:artist:9", "KR$NA")];
        assert!(credited_artists(candidates.clone(), vec![]).is_empty());
        let mut track = song("saavn:abcd1234", "Hola Amigo", "KR$NA", 226.0);
        track.artists[0].id = Some("saavn:artist:9".into());
        let supported = itunes_metadata::entities_from_tracks("KR$NA", vec![track]).artists;
        let result = credited_artists(candidates, supported);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].id, "saavn:artist:9");
        assert!(result[0].artwork_url.is_some());
        assert!(itunes_metadata::entities_from_tracks("Hola Amigo", vec![song("saavn:abcd1234", "Hola Amigo", "KR$NA", 226.0)]).artists.is_empty());
    }
    #[test]
    fn same_name_artists_keep_distinct_ids_and_matching_portraits() {
        let mut first=song("itunes:1","First","Gini",180.0);first.artists[0].id=Some("saavn:artist:1249318".into());
        let mut second=first.clone();second.id="itunes:2".into();second.artists[0].id=Some("saavn:artist:20043211".into());
        let mut results=itunes_metadata::entities_from_tracks("Gini",vec![first,second]);
        assert_eq!(results.artists.len(),2);
        results.artists.push(CatalogArtist{id:"artist:name:Gini".into(),name:"Gini".into(),artwork_url:None});
        let portrait=CatalogArtist{id:"saavn:artist:20043211".into(),name:"Gini".into(),artwork_url:Some("https://c.saavncdn.com/artists/Gini.jpg".into())};
        let results=credited_artists(vec![portrait],results.artists);
        assert_eq!(results.len(),2);
        assert!(results[0].artwork_url.is_none());assert!(results[1].artwork_url.is_some());
    }

    #[test]
    fn provider_entities_are_not_equated_by_name_or_recording_overlap() {
        let artist = |id: &str| CatalogArtist { id:id.into(), name:"Gini".into(), artwork_url:None };
        let result = credited_artists(vec![artist("saavn:artist:20043211")], vec![artist("itunes:1629301422"),artist("saavn:artist:20043211"),artist("saavn:artist:1249318"),artist("artist:name:Gini")]);
        assert_eq!(result.len(),3);
        assert!(result.iter().any(|row|row.id=="itunes:1629301422"));
        assert!(credited_artists(vec![artist("saavn:artist:42")],vec![artist("artist:name:Gini")]).is_empty());
    }

    #[test]
    fn captured_phoenix_and_aurora_homonyms_keep_their_provider_ids() {
        let corpus: serde_json::Value = serde_json::from_str(include_str!("../../tests/fixtures/artist-identity-live.json")).unwrap();
        for name in ["Phoenix","Aurora"] {
            let label=format!("apple-search-{name}");
            let data=&corpus["responses"].as_array().unwrap().iter().find(|row|row["label"]==label).unwrap()["data"]["results"];
            let artists: Vec<_> = data.as_array().unwrap().iter().filter(|row|row["artistName"].as_str().is_some_and(|candidate|catalog::same_name(candidate,name))).map(|row|CatalogArtist{id:format!("itunes:{}",row["artistId"].as_u64().unwrap()),name:row["artistName"].as_str().unwrap().into(),artwork_url:None}).collect();
            assert!(artists.len()>2);
            let ids: std::collections::HashSet<_>=artists.iter().map(|row|row.id.clone()).collect();
            let results=credited_artists(vec![],artists);
            assert_eq!(results.len(),ids.len());
            assert!(results.iter().all(|row|ids.contains(&row.id)));
        }
    }

    #[test]
    fn cached_artist_navigation_is_scoped_and_unresolved_ids_are_rejected() {
        let runtime=tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        runtime.block_on(async {
            for id in ["saavn:artist:1249318","saavn:artist:20043211","itunes:1629301422"] {
                let value=ArtistDetails { evidence: vec![], verified_ids: vec![],info:CatalogArtist{id:id.into(),name:"Gini".into(),artwork_url:None},top_tracks:vec![],albums:vec![],similar_artists:vec![]};
                save(&format!("artist:{id}"),Value::Artist(value),true);
            }
            for id in ["saavn:artist:1249318","saavn:artist:20043211","itunes:1629301422"] { assert_eq!(artist(id).await.unwrap().info.id,id); }
            for id in ["artist:name:gini","saavn:artist:name:Gini","itunes:001","saavn:artist:0","unsupported:1"] { assert!(artist(id).await.is_err()); }
            let wrong=AlbumDetails {info:CatalogAlbum{id:"itunes:88".into(),title:"Release".into(),artist:"Gini".into(),artists:vec![],artwork_url:None,year:None,track_count:None},tracks:vec![],partial:true};
            save("album:unsupported:cached",Value::Album(wrong),true);
            assert!(album("unsupported:cached").await.is_err());
        });
    }

    #[test]
    fn song_search_keeps_original_release_and_remix_instead_of_only_a_compilation() {
        let mut compilation = song("saavn:abcd1234", "Evening Song", "Singer & Guest", 230.0);
        compilation.album = "Holiday Collection".into();
        let mut original = song("itunes:1", "Evening Song", "Singer & Guest", 229.4);
        original.album = "Artist Album".into();
        let mut remix = song("itunes:2", "Evening Song (feat. Collaborator) [Remix]", "Singer & Guest", 230.4);
        remix.album = original.album.clone();
        let mut other_compilation = compilation.clone(); other_compilation.id = "saavn:efgh5678".into(); other_compilation.album = "Another Collection".into();
        let rows = merge_songs("Evening Song", vec![compilation, other_compilation], vec![original, remix], 20);
        let ids: Vec<_> = rows.iter().map(|row| row.id.as_str()).collect();
        assert_eq!(rows.len(), 3);
        assert!(ids.contains(&"itunes:1"));
        assert!(ids.contains(&"itunes:2"));
        assert!(relevance("Evening Song", "Evening Song (feat. Collaborator) [Remix]", "Singer") >= 900);
        // The second provider merge must not collapse the retained release again.
        assert_eq!(merge_songs("Evening Song", rows, vec![], 20).len(), 3);
    }
    #[test]
    fn wishes_merges_apple_despite_nonempty_unrelated_saavn_results() {
        let primary = vec![song("saavn:W57dnWhs", "Wishes Hasan Raheem", "Original Sound - Wishes Hasan Raheem", 15.0)];
        let official = song("itunes:1703418141", "Wishes", "Hasan Raheem, Umair & Talwiinder", 219.0);
        let rows = merge_songs("Hasan Raheem Wishes", primary, vec![official], 20);
        assert_eq!(rows.len(), 1); assert_eq!(rows[0].id, "itunes:1703418141");
    }
    #[test]
    fn pal_pal_requires_the_requested_artist_not_just_a_common_title() {
        let wrong = song("itunes:1071250381", "Pal Pal", "Arijit Singh", 240.0);
        assert!(merge_songs("Afusic Pal Pal", vec![wrong], vec![], 20).is_empty());
        assert!(merge_songs("Afusic Pal Pal", vec![song("saavn:LorkLIpV", "Pal Pal X Afusic Lo-Fi", "Anand Tripathi", 180.0)], vec![], 20).is_empty());
        assert_eq!(merge_songs("Afusic Pal Pal", vec![], vec![song("itunes:2", "Pal Pal", "Afusic & AliSoomroMusic", 148.0)], 20).len(), 1);
    }
    #[test]
    fn keyword_and_popularity_keep_official_pal_pal_collaboration_and_reject_irrelevant_hits() {
        let obscure = song("saavn:abcd1234", "Pal Pal", "Another Artist", 130.0);
        let mut official = song("itunes:2", "Pal Pal (with Talwiinder)", "Afusic, Talwiinder & AliSoomroMusic", 205.0);
        official.play_count = Some(1_440_000_000);
        let mut unrelated = song("itunes:3", "Other Hit", "Another Superstar", 200.0); unrelated.play_count = Some(u64::MAX);
        let rows = merge_songs("Pal Pal", vec![obscure], vec![official.clone(), unrelated], 20);
        assert_eq!(rows[0].id, official.id); assert_eq!(rows.len(), 2);
        assert_eq!(merge_songs("Pal Pal Afusic", vec![], vec![official], 20).len(), 1);
    }
    #[test]
    fn dedup_requires_recording_version_credits_and_duration_and_prefers_primary() {
        let primary = song("saavn:abcd1234", "Wishes", "Hasan Raheem, Umair & Talwiinder", 219.0);
        let same = song("itunes:1", "Wishes", "Hasan Raheem, Umair & Talwiinder", 218.0);
        let live = song("itunes:2", "Wishes (Live)", "Hasan Raheem", 219.0);
        let another = song("itunes:3", "Wishes", "Other Singer", 219.0);
        let longer = song("itunes:4", "Wishes", "Hasan Raheem", 250.0);
        assert!(same_recording(&primary, &same));
        for row in [&live, &another, &longer] { assert!(!same_recording(&primary, row)); }
        let rows = merge_songs("Wishes", vec![primary], vec![same, live, another, longer], 20);
        assert_eq!(rows.len(), 4); assert_eq!(rows[0].id, "saavn:abcd1234");
    }
    #[test]
    fn hasan_raheem_exact_credit_ranks_above_substrings_and_missing_artist() {
        assert!(relevance("Hasan Raheem", "Hasan Raheem", "") > relevance("Hasan Raheem", "Hasan Raheem Tribute", ""));
        assert_eq!(relevance("Hasan Raheem", "Hasan Rahim Tribute", ""), 0);
        assert_eq!(relevance("മഴ", "മഴ", "Singer"), 1000);
        assert_eq!(relevance("Hasan Raheem", "Wishes", "Hasan Raheem, Umair & Talwiinder"), 900);
    }
    #[test]
    fn cache_coalesces_identical_work_and_bounds_expiry() {
        let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        let count = std::sync::atomic::AtomicUsize::new(0);
        rt.block_on(async {
            let task = || async {
                let _guard = flight("test:coalesce").await;
                if cached("test:coalesce").is_none() { count.fetch_add(1, std::sync::atomic::Ordering::SeqCst); tokio::time::sleep(Duration::from_millis(5)).await; save("test:coalesce", Value::Songs(vec![]), false); }
            };
            tokio::join!(task(), task());
        });
        assert_eq!(count.load(std::sync::atomic::Ordering::SeqCst), 1);
        assert!(cached("test:coalesce").is_some());
        CACHE.get().unwrap().lock().unwrap().get_mut("test:coalesce").unwrap().0 = Instant::now() - Duration::from_secs(1);
        assert!(cached("test:coalesce").is_none()); assert!(stale("test:coalesce").is_some());
    }
    #[test]
    fn invalid_and_ambiguous_locators_never_become_provider_queries() {
        assert!(!catalog::valid_artist_id("saavn:artist:%00Hasan")); assert!(!catalog::valid_artist_id(""));
        let a = CatalogAlbum { id: "1".into(), title: "Release".into(), artist: "Hasan Raheem".into(), artists: vec![], year: Some(2023), artwork_url: None, track_count: None };
        let mut b = a.clone(); b.id = "2".into(); b.year = Some(2024); assert!(!same_album(&a, &b));
    }
    #[test]
    #[ignore = "explicit live search provider verification"]
    fn live_search_preserves_original_and_remix() {
        let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        rt.block_on(async {
            let rows = search("despacito", 20).await.unwrap();
            println!("{:?}", rows.iter().map(|row| (&row.id, &row.title, &row.artist, &row.album)).collect::<Vec<_>>());
            assert!(rows.iter().any(|row| row.title == "Despacito" && row.artist.contains("Luis Fonsi") && row.album == "VIDA"));
            assert!(rows.iter().any(|row| row.title.contains("Justin Bieber") && row.title.contains("Remix") && row.artist.contains("Luis Fonsi")));
        });
    }
    #[test]
    #[ignore = "explicit live provider and MusicBrainz coverage verification"]
    fn live_pakistani_catalog() {
        let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        rt.block_on(async {
            for query in ["Hasan Raheem Wishes", "Afusic Pal Pal", "Hasan Raheem"] {
                let start = Instant::now(); let rows = search(query, 30).await.unwrap();
                println!("{query}: {} rows in {:?}: {:?}", rows.len(), start.elapsed(), rows.iter().take(5).map(|row| (&row.id, &row.title, &row.artist)).collect::<Vec<_>>());
                assert!(rows.iter().all(|row| relevance(query, &row.title, &row.artist) > 0));
                if query.contains("Wishes") { assert!(rows.iter().any(|row| row.title == "Wishes" && row.artist.contains("Hasan Raheem"))); }
            }
            let options = entities("Hasan Raheem").await.unwrap();
            let selected = options.artists.iter().find(|artist| catalog::same_name(&artist.name, "Hasan Raheem")).unwrap();
            let profile = artist(&selected.id).await.unwrap();
            println!("artist: {} {}, tracks={}, albums={}", profile.info.id, profile.info.name, profile.top_tracks.len(), profile.albums.len());
            assert!(catalog::same_name(&profile.info.name, "Hasan Raheem")); assert!(!profile.top_tracks.is_empty()); assert!(!profile.albums.is_empty());
            if let Some(release) = profile.albums.first() { let details = album(&release.id).await.unwrap(); assert!(!details.tracks.is_empty()); println!("album {}: {} tracks", details.info.title, details.tracks.len()); }
            let metadata = crate::music_metadata::music_metadata("artist".into(), "Hasan Raheem".into(), "".into()).await.unwrap();
            println!("identity: {:?}", metadata.as_ref().map(|value| (&value.provider, &value.source_url))); assert!(metadata.is_some());
        });
    }
}
