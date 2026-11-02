//! Local replicated registers. Tombstones are retained; transport acknowledgements never delete data.
use crate::{err, listening, work, Result};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::AppHandle;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Cell {
    pub key: String,
    pub clock: i64,
    pub device: String,
    pub value: Value,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct State {
    pub device_id: String,
    pub clock: i64,
    pub revision: i64,
    pub cells: Vec<Cell>,
    pub history_enabled: bool,
    #[serde(default)]
    pub favorites_enabled: bool,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Packet {
    pub device_id: String,
    pub since: i64,
    pub cells: Vec<Cell>,
    pub history: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub favorites: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub checkpoint: Option<PlaybackCheckpoint>,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Reply {
    pub device_id: String,
    pub cursor: i64,
    pub cells: Vec<Cell>,
    pub more: bool,
    pub history: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub favorites: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub checkpoint: Option<PlaybackCheckpoint>,
}

pub fn initialize(db: &Connection) -> Result<()> {
    db.execute_batch("CREATE TABLE IF NOT EXISTS sync_state(id INTEGER PRIMARY KEY CHECK(id=1),device TEXT NOT NULL,clock INTEGER NOT NULL DEFAULT 0,revision INTEGER NOT NULL DEFAULT 0,history INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS sync_cells(key TEXT PRIMARY KEY,clock INTEGER NOT NULL,device TEXT NOT NULL,value TEXT NOT NULL,revision INTEGER NOT NULL);
        CREATE INDEX IF NOT EXISTS sync_revision ON sync_cells(revision);
        CREATE TABLE IF NOT EXISTS sync_peers(device TEXT PRIMARY KEY,sent INTEGER NOT NULL,received INTEGER NOT NULL,history INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS sync_host(id INTEGER PRIMARY KEY CHECK(id=1),port INTEGER NOT NULL,token TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS playback_checkpoints(device_id TEXT PRIMARY KEY,checkpoint TEXT NOT NULL,captured_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS sync_peer_info(device_id TEXT PRIMARY KEY,name TEXT NOT NULL DEFAULT '',last_seen INTEGER NOT NULL);") .map_err(err)?;
    db.execute(
        "INSERT OR IGNORE INTO sync_state(id,device) VALUES(1,?1)",
        [uuid::Uuid::new_v4().to_string()],
    )
    .map_err(err)?;
    let has_favorites = db.prepare("PRAGMA table_info(sync_state)").map_err(err)?
        .query_map([], |r| r.get::<_, String>(1)).map_err(err)?
        .collect::<std::result::Result<Vec<_>, _>>().map_err(err)?
        .iter().any(|name| name == "favorites");
    if !has_favorites {
        db.execute_batch("ALTER TABLE sync_state ADD COLUMN favorites INTEGER NOT NULL DEFAULT 1;").map_err(err)?;
    }
    Ok(())
}

pub fn persist_session_cells(db: &Connection, session: &Value) -> Result<()> {
    if let Some(cells) = session["replica"]["cells"].as_object() {
        let old: Option<String> = db
            .query_row("SELECT data FROM app_state WHERE id=1", [], |r| r.get(0))
            .optional()
            .map_err(err)?;
        let previous: Value = old
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        let cells = cells
            .iter()
            .filter(|(key, value)| previous["replica"]["cells"][key.as_str()] != **value)
            .map(|(_, v)| serde_json::from_value(v.clone()))
            .collect::<std::result::Result<Vec<Cell>, _>>()
            .map_err(err)?;
        merge(db, &cells, false)?;
    }
    Ok(())
}
pub fn key(parts: &[&str]) -> String {
    serde_json::to_string(parts).unwrap()
}
fn history_key(k: &str) -> bool {
    k.starts_with("[\"history\",") || k == key(&["clear"])
}
fn favorite_key(k: &str) -> bool {
    k.starts_with("[\"fav-track\",") || k.starts_with("[\"fav-artist\",") || k.starts_with("[\"fav-album\",")
}
fn epoch_version(value: &str) -> Result<(i64, String)> {
    if value.is_empty() {
        return Ok((0, String::new()));
    }
    let (clock, device) = value.split_once(':').ok_or("Invalid history epoch.")?;
    let clock = clock.parse::<i64>().map_err(|_| "Invalid history epoch.")?;
    if clock <= 0 || uuid::Uuid::parse_str(device).is_err() {
        return Err("Invalid history epoch.".into());
    }
    Ok((clock, device.into()))
}
pub fn state(db: &Connection, cells: bool) -> Result<State> {
    let (device_id, clock, revision, history_enabled, favorites_enabled) = db
        .query_row(
            "SELECT device,clock,revision,history,COALESCE(favorites,1) FROM sync_state WHERE id=1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
        )
        .map_err(err)?;
    let mut result = State {
        device_id,
        clock,
        revision,
        cells: vec![],
        history_enabled,
        favorites_enabled,
    };
    if cells {
        result.cells = page_favorites(db, 0, false, true, usize::MAX)?.cells;
    }
    Ok(result)
}
fn get(db: &Connection, key: &str) -> Result<Option<Cell>> {
    db.query_row(
        "SELECT clock,device,value FROM sync_cells WHERE key=?1",
        [key],
        |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
            ))
        },
    )
    .optional()
    .map_err(err)?
    .map(|(clock, device, value)| {
        Ok(Cell {
            key: key.into(),
            clock,
            device,
            value: serde_json::from_str(&value).map_err(err)?,
        })
    })
    .transpose()
}
fn parts(cell: &Cell) -> Result<Vec<String>> {
    if cell.key.len() > if favorite_key(&cell.key) { 12000 } else { 2000 }
        || cell.clock <= 0
        || cell.clock > 9_007_199_254_740_991
        || uuid::Uuid::parse_str(&cell.device).is_err()
    {
        return Err("Invalid sync version.".into());
    }
    let p: Vec<String> = serde_json::from_str(&cell.key).map_err(|_| "Invalid sync key.")?;
    if p.iter().any(|s| s.is_empty() || s.len() > if favorite_key(&cell.key) { 10000 } else { 700 })
        || key(&p.iter().map(String::as_str).collect::<Vec<_>>()) != cell.key
    {
        return Err("Invalid sync key.".into());
    }
    Ok(p)
}
fn clean_short_string(s: &str, max: usize) -> bool {
    !s.trim().is_empty() && s.len() <= max && !s.chars().any(char::is_control)
}
fn valid_favorite_id(id: &str, artist: bool) -> bool {
    use std::sync::LazyLock;
    static ARTIST: LazyLock<regex::Regex> = LazyLock::new(|| regex::Regex::new(r"^(?:musicbrainz:artist:[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}|saavn:artist:[1-9]\d{0,19}|itunes:[1-9]\d{0,19}|(?:saavn:)?artist:name:[^:]{1,1200})$").unwrap());
    static ALBUM: LazyLock<regex::Regex> = LazyLock::new(|| regex::Regex::new(r"^(?:musicbrainz:release:[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}|saavn:album:[1-9]\d{0,19}|itunes:[1-9]\d{0,19}|saavn:album:search:[^:]{1,1200}:[^:]{1,1200})$").unwrap());
    if artist { ARTIST.is_match(id) } else { ALBUM.is_match(id) }
}
fn validate(cell: &mut Cell) -> Result<()> {
    let p = parts(cell)?;
    match p.first().map(String::as_str) {
        Some("name")
            if p.len() == 2
                && cell.value.as_str().is_some_and(|s| clean_short_string(s, 400)) => {}
        Some("deleted") if p.len() == 2 && cell.value == true => {}
        Some("removed") if p.len() == 3 && cell.value == true => {}
        Some("entry") if p.len() == 3 => {
            if !cell.value["position"]
                .as_f64()
                .is_some_and(|n| n.is_finite() && (0.0..=50000.0).contains(&n))
                || cell.value.as_object().is_none_or(|v| v.len() != 2)
            {
                return Err("Invalid sync entry.".into());
            }
            let mut track = serde_json::from_value(cell.value["track"].clone())
                .map_err(|_| "Invalid sync track.")?;
            crate::nearby::clean_track(&mut track)?;
            cell.value["track"] = serde_json::to_value(track).map_err(err)?;
        }
        Some("clear") if p.len() == 1 && cell.value == true => {}
        Some("history") if p.len() == 2 => {
            if cell.value.as_object().is_none_or(|v| v.len() != 2)
                || !cell.value["epoch"].is_string()
            {
                return Err("Invalid history sync entry.".into());
            }
            let mut record: listening::ListeningRecord =
                serde_json::from_value(cell.value["record"].clone())
                    .map_err(|_| "Invalid history sync record.")?;
            listening::validate(&mut record)?;
            if record.id != p[1] {
                return Err("History identity does not match its sync key.".into());
            }
            if epoch_version(cell.value["epoch"].as_str().unwrap_or(""))?.0 >= cell.clock {
                return Err("Invalid history epoch version.".into());
            }
            cell.value["record"] = serde_json::to_value(record).map_err(err)?;
        }
        Some("fav-track") if p.len() == 2 => {
            if cell.value != false {
                let mut track: crate::Track = serde_json::from_value(cell.value.clone()).map_err(|_| "Invalid favorite track.")?;
                crate::nearby::clean_track(&mut track)?;
                if track.id != p[1] { return Err("Favorite identity does not match its sync key.".into()); }
                cell.value = serde_json::to_value(track).map_err(err)?;
            }
        }
        // fav-artist: value is {id, name} object or false tombstone.
        Some("fav-artist") if p.len() == 2 && valid_favorite_id(&p[1], true) => {
            if cell.value == false {
                // tombstone — ok
            } else {
                let obj = cell.value.as_object().ok_or("Invalid fav-artist value.")?;
                if obj.len() < 2
                    || obj.get("id").and_then(|v| v.as_str()) != Some(p[1].as_str())
                    || !valid_favorite_id(&p[1], true)
                    || !obj.get("name").and_then(|v| v.as_str()).is_some_and(|s| clean_short_string(s, 4000))
                {
                    return Err("Invalid fav-artist value.".into());
                }
                // artworkUrl may be null or https string; strip everything else.
                let artwork = obj.get("artworkUrl").cloned().unwrap_or(Value::Null);
                let safe_artwork = if artwork.as_str().is_some_and(|u| u.starts_with("https://") && u.len() <= 2000) {
                    artwork
                } else {
                    Value::Null
                };
                cell.value = json!({ "id": obj["id"], "name": obj["name"], "artworkUrl": safe_artwork });
            }
        }
        // fav-album: value is {id, title, artist[, artworkUrl, year]} object or false tombstone.
        Some("fav-album") if p.len() == 2 && valid_favorite_id(&p[1], false) => {
            if cell.value == false {
                // tombstone — ok
            } else {
                let obj = cell.value.as_object().ok_or("Invalid fav-album value.")?;
                if obj.len() < 3
                    || obj.get("id").and_then(|v| v.as_str()) != Some(p[1].as_str())
                    || !valid_favorite_id(&p[1], false)
                    || !obj.get("title").and_then(|v| v.as_str()).is_some_and(|s| s.len() <= 4000)
                    || !obj.get("artist").and_then(|v| v.as_str()).is_some_and(|s| s.len() <= 4000)
                {
                    return Err("Invalid fav-album value.".into());
                }
                let artwork = obj.get("artworkUrl").cloned().unwrap_or(Value::Null);
                let safe_artwork = if artwork.as_str().is_some_and(|u| u.starts_with("https://") && u.len() <= 2000) {
                    artwork
                } else {
                    Value::Null
                };
                let year = obj.get("year").and_then(|v| v.as_i64()).filter(|&y| y > 0 && y < 3000);
                cell.value = json!({ "id": obj["id"], "title": obj["title"], "artist": obj["artist"], "artworkUrl": safe_artwork, "year": year });
            }
        }
        _ => return Err("Unsupported sync field.".into()),
    }
    Ok(())
}
pub fn epoch(db: &Connection) -> Result<String> {
    Ok(get(db, &key(&["clear"]))?
        .map(|c| format!("{}:{}", c.clock, c.device))
        .unwrap_or_default())
}
pub fn merge(db: &Connection, cells: &[Cell], history: bool) -> Result<bool> {
    if cells.len() > 100_000 {
        return Err("Sync collection is too large.".into());
    }
    let old_epoch = epoch(db)?;
    let mut changed = false;
    let mut history_changed = false;
    let mut events = vec![];
    for original in cells {
        if history_key(&original.key) && !history {
            continue;
        }
        let mut cell = original.clone();
        validate(&mut cell)?;
        if cell.key.starts_with("[\"history\",")
            && epoch_version(cell.value["epoch"].as_str().unwrap_or(""))?
                < epoch_version(&epoch(db)?)?
        {
            continue;
        }
        let old = get(db, &cell.key)?;
        if let Some(old) = &old {
            if cell.key.starts_with("[\"history\",") {
                let a = &cell.value["record"];
                let b = &old.value["record"];
                for k in ["trackId", "startedAt", "providerId", "sourceId"] {
                    if a[k] != b[k] {
                        return Err("A synced play cannot change identity.".into());
                    }
                }
                if cell.value["epoch"] != old.value["epoch"] {
                    return Err("A synced play cannot change its clear epoch.".into());
                }
                if a["listenedMs"].as_i64() < b["listenedMs"].as_i64()
                    || a["updatedAt"].as_i64() < b["updatedAt"].as_i64()
                    || b["days"].as_object().is_some_and(|days| {
                        days.iter().any(|(day, time)| {
                            a["days"][day].as_i64().unwrap_or(0) < time.as_i64().unwrap_or(0)
                        })
                    })
                {
                    continue;
                }
            }
            if (cell.clock, &cell.device) < (old.clock, &old.device) {
                continue;
            }
            if (cell.clock, &cell.device) == (old.clock, &old.device) {
                // Old databases may omit fields added to portable track metadata.
                // Compare both versions using the current validation/defaults.
                let mut normalized_old = old.clone();
                validate(&mut normalized_old)?;
                if cell.value != normalized_old.value {
                    return Err("Conflicting sync versions; existing data preserved.".into());
                }
                continue;
            }
        }
        db.execute(
            "UPDATE sync_state SET clock=MAX(clock,?1),revision=revision+1 WHERE id=1",
            [cell.clock],
        )
        .map_err(err)?;
        db.execute("INSERT INTO sync_cells(key,clock,device,value,revision) VALUES(?1,?2,?3,?4,(SELECT revision FROM sync_state WHERE id=1)) ON CONFLICT(key) DO UPDATE SET clock=excluded.clock,device=excluded.device,value=excluded.value,revision=excluded.revision", params![cell.key,cell.clock,cell.device,serde_json::to_string(&cell.value).map_err(err)?]).map_err(err)?;
        changed = true;
        history_changed |= history_key(&cell.key);
        if cell.key.starts_with("[\"history\",") {
            events.push(cell.value);
        }
    }
    if db
        .query_row("SELECT COUNT(*) FROM sync_cells", [], |r| {
            r.get::<_, i64>(0)
        })
        .map_err(err)?
        > 100_000
    {
        return Err("Sync collection limit reached; existing data preserved.".into());
    }
    if history_changed {
        let current = epoch(db)?;
        if old_epoch != current {
            db.execute(
                "UPDATE listening_state SET generation=generation+1 WHERE id=1",
                [],
            )
            .map_err(err)?;
            db.execute("DELETE FROM listening_records", [])
                .map_err(err)?;
        }
        if old_epoch != current {
            let values = {
                let mut stmt = db
                    .prepare("SELECT key,value FROM sync_cells WHERE key LIKE '[\"history\",%'")
                    .map_err(err)?;
                let rows = stmt
                    .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
                    .map_err(err)?
                    .collect::<std::result::Result<Vec<_>, _>>()
                    .map_err(err)?;
                rows
            };
            events.clear();
            for (key, raw) in values {
                let v: Value = serde_json::from_str(&raw).map_err(err)?;
                if epoch_version(v["epoch"].as_str().unwrap_or(""))? < epoch_version(&current)? {
                    db.execute("DELETE FROM sync_cells WHERE key=?1", [key])
                        .map_err(err)?;
                } else {
                    events.push(v);
                }
            }
        }
        for v in events {
            if v["epoch"].as_str() == Some(&current) {
                let record = serde_json::from_value(v["record"].clone()).map_err(err)?;
                listening::write_record(db, record)?;
            }
        }
    }
    Ok(changed)
}
pub fn local(db: &Connection, k: String, value: Value) -> Result<()> {
    // Reserve a unique Lamport version in SQLite itself; a read-then-increment
    // lets concurrent local writes reuse the same (clock, device) pair.
    let (clock, device): (i64, String) = db.query_row(
        "UPDATE sync_state SET clock=clock+1 WHERE id=1 RETURNING clock,device",
        [],
        |row| Ok((row.get(0)?, row.get(1)?)),
    ).map_err(err)?;
    merge(
        db,
        &[Cell {
            key: k,
            clock,
            device,
            value,
        }],
        true,
    )?;
    Ok(())
}
pub fn checkpoint(db: &Connection, record: &listening::ListeningRecord) -> Result<()> {
    if !state(db, false)?.history_enabled {
        return Ok(());
    }
    let k = key(&["history", &record.id]);
    let e = get(db, &k)?
        .map(|c| c.value["epoch"].as_str().unwrap_or("").to_owned())
        .unwrap_or(epoch(db)?);
    local(db, k, json!({"epoch":e,"record":record}))
}
#[cfg(test)]
pub fn page(db: &Connection, since: i64, history: bool, limit: usize) -> Result<Reply> {
    page_favorites(db, since, history, false, limit)
}
pub fn page_favorites(db: &Connection, since: i64, history: bool, favorites: bool, limit: usize) -> Result<Reply> {
    let status = state(db, false)?;
    let mut stmt = db.prepare("SELECT key,clock,device,value,revision FROM sync_cells WHERE revision>?1 ORDER BY revision").map_err(err)?;
    let mut rows = stmt.query([since]).map_err(err)?;
    let current_epoch = epoch(db)?;
    let mut cells = vec![];
    let mut cursor = since;
    let mut more = false;
    let mut bytes = 0;
    while let Some(r) = rows.next().map_err(err)? {
        let k: String = r.get(0).map_err(err)?;
        if history_key(&k) && !history {
            continue;
        }
        if favorite_key(&k) && !favorites { continue; }
        let value: Value =
            serde_json::from_str(&r.get::<_, String>(3).map_err(err)?).map_err(err)?;
        if k.starts_with("[\"history\",")
            && epoch_version(value["epoch"].as_str().unwrap_or(""))?
                < epoch_version(&current_epoch)?
        {
            continue;
        }
        let cell = Cell {
            key: k,
            clock: r.get(1).map_err(err)?,
            device: r.get(2).map_err(err)?,
            value,
        };
        let size = serde_json::to_vec(&cell).map_err(err)?.len();
        if limit != usize::MAX && (cells.len() == limit || bytes + size > 750_000) {
            more = true;
            break;
        }
        bytes += size;
        cursor = r.get(4).map_err(err)?;
        cells.push(cell);
    }
    if !more {
        cursor = status.revision
    }
    Ok(Reply {
        device_id: status.device_id,
        cursor,
        cells,
        more,
        history,
        favorites: None,
        checkpoint: None,
    })
}
pub fn handle(db: &mut Connection, path: &str, bytes: &[u8]) -> Result<Vec<u8>> {
    if path == "GET /v2/hello HTTP/1.1" || path == "GET /v3/hello HTTP/1.1" {
        let mut value = serde_json::to_value(state(db, false)?).map_err(err)?;
        if path == "GET /v2/hello HTTP/1.1" { value.as_object_mut().unwrap().remove("favoritesEnabled"); }
        return serde_json::to_vec(&value).map_err(err);
    }
    let packet: Packet = serde_json::from_slice(bytes).map_err(|_| "Invalid sync packet.")?;
    if uuid::Uuid::parse_str(&packet.device_id).is_err()
        || packet.since < 0
        || packet.cells.len() > 100
    {
        return Err("Invalid sync packet.".into());
    }
    let tx = db.transaction().map_err(err)?;
    let status = state(&tx, false)?;
    if status.device_id == packet.device_id {
        return Err("Cannot sync a device with itself.".into());
    }
    let history = status.history_enabled && packet.history;
    let v3 = path == "POST /v3/sync HTTP/1.1";
    let favorites = v3 && status.favorites_enabled && packet.favorites == Some(true);
    let cells: Vec<_> = packet.cells.into_iter().filter(|c| favorites || !favorite_key(&c.key)).collect();
    merge(&tx, &cells, history)?;
    
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;
    let peer_name = packet.checkpoint.as_ref().and_then(|c| c.device_name.clone()).unwrap_or_default();
    let _ = tx.execute(
        "INSERT INTO sync_peer_info(device_id, name, last_seen) VALUES(?1, ?2, ?3)
         ON CONFLICT(device_id) DO UPDATE SET 
         last_seen=excluded.last_seen,
         name=CASE WHEN excluded.name != '' THEN excluded.name ELSE sync_peer_info.name END",
        params![packet.device_id, peer_name, now_ms],
    );
    
    // Save received checkpoint if present
    if let Some(mut received_checkpoint) = packet.checkpoint {
        if validate_checkpoint(&mut received_checkpoint).is_ok() {
            let serialized = serde_json::to_string(&received_checkpoint).unwrap_or_default();
            if serialized.len() <= 500_000 {
                let _ = tx.execute(
                    "INSERT INTO playback_checkpoints(device_id, checkpoint, captured_at, updated_at) 
                     VALUES(?1, ?2, ?3, ?4) 
                     ON CONFLICT(device_id) DO UPDATE SET 
                     checkpoint=excluded.checkpoint, 
                     captured_at=excluded.captured_at, 
                     updated_at=excluded.updated_at
                     WHERE excluded.captured_at >= playback_checkpoints.captured_at",
                    params![
                        received_checkpoint.device_id,
                        serialized,
                        received_checkpoint.captured_at,
                        now_ms
                    ],
                );
            }
        }
    }
    
    let mut response = page_favorites(&tx, packet.since, history, favorites, 100)?;
    if v3 { response.favorites = Some(favorites); }
    
    // Include our checkpoint in response
    response.checkpoint = if v3 {
        tx.query_row(
            "SELECT checkpoint FROM playback_checkpoints WHERE device_id=?1",
            [status.device_id.clone()],
            |row| row.get::<_, String>(0)
        ).optional().map_err(err)?
        .and_then(|json| serde_json::from_str(&json).ok())
    } else {
        None
    };
    
    tx.commit().map_err(err)?;
    serde_json::to_vec(&response).map_err(err)
}
#[tauri::command]
pub async fn get_sync_state(app: AppHandle, since: Option<i64>) -> Result<State> {
    work(app, move |_, db| {
        let mut result = state(db, false)?;
        result.cells = page_favorites(db, since.unwrap_or(0).max(0), false, result.favorites_enabled, usize::MAX)?.cells;
        Ok(result)
    })
    .await
}
#[tauri::command]
pub async fn set_history_sync(app: AppHandle, enabled: bool) -> Result<State> {
    work(app, move |_, db| {
        let tx = db.transaction().map_err(err)?;
        tx.execute("UPDATE sync_state SET history=?1 WHERE id=1", [enabled])
            .map_err(err)?;
        tx.execute("DELETE FROM sync_peers", []).map_err(err)?;
        if enabled {
            for record in listening::read(&tx)?.records {
                checkpoint(&tx, &record)?;
            }
        }
        let result = state(&tx, true)?;
        tx.commit().map_err(err)?;
        Ok(result)
    })
    .await
}
#[tauri::command]
pub async fn set_favorites_sync(app: AppHandle, enabled: bool) -> Result<State> {
    work(app, move |_, db| {
        let tx = db.transaction().map_err(err)?;
        tx.execute("UPDATE sync_state SET favorites=?1 WHERE id=1", [enabled])
            .map_err(err)?;
        tx.execute("DELETE FROM sync_peers", []).map_err(err)?;
        let result = state(&tx, true)?;
        tx.commit().map_err(err)?;
        Ok(result)
    })
    .await
}
#[cfg(test)]
pub fn peer(db: &Connection, id: &str, history: bool) -> Result<(i64, i64)> {
    peer_favorites(db, id, history, false)
}
pub fn peer_favorites(db: &Connection, id: &str, history: bool, favorites: bool) -> Result<(i64, i64)> {
    Ok(db
        .query_row(
            "SELECT sent,received FROM sync_peers WHERE device=?1 AND history=?2",
            params![id, i64::from(history) | (i64::from(favorites) << 1)],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(err)?
        .unwrap_or((0, 0)))
}
pub fn accept(db: &mut Connection, reply: Reply, sent: i64) -> Result<()> {
    let tx = db.transaction().map_err(err)?;
    let enabled = state(&tx, false)?.history_enabled && reply.history;
    let favorites = state(&tx, false)?.favorites_enabled && reply.favorites == Some(true);
    let cells: Vec<_> = reply.cells.into_iter().filter(|c| favorites || !favorite_key(&c.key)).collect();
    merge(&tx, &cells, enabled)?;
    
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;
    let peer_name = reply.checkpoint.as_ref().and_then(|c| c.device_name.clone()).unwrap_or_default();

    // Save received checkpoint if present
    if let Some(mut received_checkpoint) = reply.checkpoint {
        if validate_checkpoint(&mut received_checkpoint).is_ok() {
            let serialized = serde_json::to_string(&received_checkpoint).unwrap_or_default();
            if serialized.len() <= 500_000 {
                let _ = tx.execute(
                    "INSERT INTO playback_checkpoints(device_id, checkpoint, captured_at, updated_at) 
                     VALUES(?1, ?2, ?3, ?4) 
                     ON CONFLICT(device_id) DO UPDATE SET 
                     checkpoint=excluded.checkpoint, 
                     captured_at=excluded.captured_at, 
                     updated_at=excluded.updated_at
                     WHERE excluded.captured_at >= playback_checkpoints.captured_at",
                    params![
                        received_checkpoint.device_id,
                        serialized,
                        received_checkpoint.captured_at,
                        now_ms
                    ],
                );
            }
        }
    }
    
    tx.execute("INSERT INTO sync_peers(device,sent,received,history) VALUES(?1,?2,?3,?4) ON CONFLICT(device) DO UPDATE SET sent=excluded.sent,received=excluded.received,history=excluded.history",params![reply.device_id,sent,reply.cursor,i64::from(enabled) | (i64::from(favorites) << 1)]).map_err(err)?;
    let _ = tx.execute(
        "INSERT INTO sync_peer_info(device_id, name, last_seen) VALUES(?1, ?2, ?3)
         ON CONFLICT(device_id) DO UPDATE SET 
         last_seen=excluded.last_seen,
         name=CASE WHEN excluded.name != '' THEN excluded.name ELSE sync_peer_info.name END",
        params![reply.device_id, peer_name, now_ms],
    );
    tx.commit().map_err(err)
}

// Playback checkpoint persistence
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlaybackCheckpoint {
    pub version: i64,
    pub id: String,
    pub device_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub device_name: Option<String>,
    pub captured_at: i64,
    pub playing: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_entry_id: Option<String>,
    pub position: f64,
    pub queue: Vec<CheckpointQueueEntry>,
    pub shuffle_order: Vec<String>,
    pub shuffle: bool,
    pub repeat: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub playlist_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub playlist_name: Option<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CheckpointQueueEntry {
    pub id: String,
    pub track_id: String,
    pub metadata: crate::Track,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub requested: Option<bool>,
}

fn validate_checkpoint(checkpoint: &mut PlaybackCheckpoint) -> Result<()> {
    if checkpoint.version != 1 {
        return Err(format!("Unsupported checkpoint version: {}", checkpoint.version).into());
    }
    if checkpoint.device_id.is_empty() || uuid::Uuid::parse_str(&checkpoint.device_id).is_err() {
        return Err("Invalid checkpoint device ID.".into());
    }
    if checkpoint.captured_at <= 0 || checkpoint.captured_at > 9_007_199_254_740_991 {
        return Err("Invalid checkpoint timestamp.".into());
    }
    if checkpoint.position < 0.0 || checkpoint.position > 86400.0 || !checkpoint.position.is_finite() {
        return Err("Invalid checkpoint position.".into());
    }
    if !["off", "all", "one"].contains(&checkpoint.repeat.as_str()) {
        return Err("Invalid repeat mode.".into());
    }
    if checkpoint.queue.is_empty() || checkpoint.queue.len() > 200 {
        return Err("Invalid checkpoint queue size.".into());
    }
    
    // Validate all queue entries have portable tracks
    for entry in &mut checkpoint.queue {
        if entry.id.is_empty() || entry.track_id.is_empty() {
            return Err("Invalid checkpoint queue entry.".into());
        }
        crate::nearby::clean_track(&mut entry.metadata)?;
        if entry.metadata.id != entry.track_id {
            return Err("Checkpoint queue entry track ID mismatch.".into());
        }
    }
    
    Ok(())
}

#[tauri::command]
pub async fn save_playback_checkpoint(app: AppHandle, checkpoint: Value) -> Result<()> {
    work(app, move |_, db| {
        let mut cp: PlaybackCheckpoint = serde_json::from_value(checkpoint)
            .map_err(|e| format!("Invalid checkpoint format: {}", e))?;
        
        let local_device_id = state(db, false)?.device_id;
        if cp.device_id != local_device_id {
            let _ = db.execute("DELETE FROM playback_checkpoints WHERE device_id=?1", params![cp.device_id]);
        }
        cp.device_id = local_device_id;
        
        validate_checkpoint(&mut cp)?;
        
        let serialized = serde_json::to_string(&cp).map_err(err)?;
        if serialized.len() > 500_000 {
            return Err("Checkpoint exceeds size limit.".into());
        }
        
        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64;
        
        db.execute(
            "INSERT INTO playback_checkpoints(device_id, checkpoint, captured_at, updated_at) 
             VALUES(?1, ?2, ?3, ?4) 
             ON CONFLICT(device_id) DO UPDATE SET 
             checkpoint=excluded.checkpoint, 
             captured_at=excluded.captured_at, 
             updated_at=excluded.updated_at",
            params![
                cp.device_id,
                serialized,
                cp.captured_at,
                now_ms
            ],
        )
        .map_err(err)?;
        
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn get_playback_checkpoints(app: AppHandle) -> Result<Vec<PlaybackCheckpoint>> {
    work(app, move |_, db| {
        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64;
        let one_hour_ago = now_ms - 3_600_000;
        let _ = db.execute("DELETE FROM playback_checkpoints WHERE captured_at < ?1", params![one_hour_ago]);
        let mut stmt = db
            .prepare("SELECT checkpoint FROM playback_checkpoints ORDER BY updated_at DESC")
            .map_err(err)?;
        
        let checkpoints = stmt
            .query_map([], |row| {
                let data: String = row.get(0)?;
                Ok(data)
            })
            .map_err(err)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(err)?
            .into_iter()
            .filter_map(|json_str| serde_json::from_str(&json_str).ok())
            .collect();
        
        Ok(checkpoints)
    })
    .await
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncPeer {
    pub device_id: String,
    pub name: String,
    pub last_seen: i64,
}

#[tauri::command]
pub async fn get_sync_peer(app: AppHandle) -> Result<Option<SyncPeer>> {
    work(app, move |_, db| {
        let peer = db.query_row(
            "SELECT device_id, name, last_seen FROM sync_peer_info ORDER BY last_seen DESC LIMIT 1",
            [],
            |row| Ok(SyncPeer {
                device_id: row.get(0)?,
                name: row.get(1)?,
                last_seen: row.get(2)?,
            })
        ).optional().map_err(err)?;
        Ok(peer)
    })
    .await
}

#[tauri::command]
pub async fn delete_playback_checkpoint(app: AppHandle, device_id: String) -> Result<()> {
    work(app, move |_, db| {
        db.execute(
            "DELETE FROM playback_checkpoints WHERE device_id=?1",
            [device_id],
        )
        .map_err(err)?;
        Ok(())
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    #[ignore = "requires a private local database snapshot via LUMAIRE_SYNC_REPRO_DB"]
    fn copied_legacy_sync_cells_can_be_replayed_without_conflict() {
        let source = Connection::open_with_flags(std::env::var("LUMAIRE_SYNC_REPRO_DB").expect("snapshot path"), rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
        let cells = source.prepare("SELECT key,clock,device,value FROM sync_cells").unwrap().query_map([], |row| Ok(Cell{key:row.get(0)?,clock:row.get(1)?,device:row.get(2)?,value:serde_json::from_str(&row.get::<_,String>(3)?).unwrap()})).unwrap().collect::<std::result::Result<Vec<_>,_>>().unwrap();
        let db = db();
        for cell in cells.iter().filter(|cell| !history_key(&cell.key)) {
            db.execute("INSERT INTO sync_cells(key,clock,device,value,revision) VALUES(?1,?2,?3,?4,1)",params![cell.key,cell.clock,cell.device,cell.value.to_string()]).unwrap();
            assert!(!merge(&db,&[cell.clone()],false).unwrap());
        }
    }

    #[test]
    fn same_version_legacy_tracks_remain_idempotent_after_schema_upgrade() {
        for kind in ["entry", "fav-track"] {
            let db = db();
            let track = json!({"id":"youtube:abcdefghijk","title":"Song","artist":"Artist","album":"","duration":180.0,"fileName":"","missing":false,"format":"YouTube","source":{"providerId":"youtube","sourceId":"abcdefghijk","pageUrl":"https://www.youtube.com/watch?v=abcdefghijk","license":"","licenseUrl":"","attribution":"Artist"}});
            let k = if kind == "entry" { key(&[kind,"mix","entry"]) } else { key(&[kind,"youtube:abcdefghijk"]) };
            let mut cell = Cell { key:k,clock:1,device:state(&db,false).unwrap().device_id,value:if kind=="entry" {json!({"track":track,"position":0})} else {track} };
            merge(&db,&[cell.clone()],false).unwrap();
            let mut stored = get(&db,&cell.key).unwrap().unwrap();
            let track = if kind=="entry" { &mut stored.value["track"] } else { &mut stored.value };
            track.as_object_mut().unwrap().remove("recordingMetadata");
            db.execute("UPDATE sync_cells SET value=?1 WHERE key=?2",params![stored.value.to_string(),cell.key]).unwrap();
            assert!(!merge(&db,&[cell.clone()],false).unwrap());
            let track = if kind=="entry" { &mut cell.value["track"] } else { &mut cell.value };
            track["title"] = json!("Different song");
            assert!(merge(&db,&[cell],false).unwrap_err().contains("Conflicting sync versions"));
        }
    }

    #[test]
    fn repeated_local_updates_to_one_key_get_distinct_versions() {
        let db = db();
        let k = key(&["name", "same-playlist"]);
        local(&db, k.clone(), json!("Before")).unwrap();
        local(&db, k.clone(), json!("After")).unwrap();
        let cell = get(&db, &k).unwrap().unwrap();
        assert_eq!(cell.value, json!("After"));
        assert_eq!(cell.clock, 2);
        assert_eq!(state(&db, false).unwrap().clock, 2);
    }

    pub fn db() -> Connection {
        let mut db = Connection::open_in_memory().unwrap();
        crate::initialize(&mut db).unwrap();
        db
    }
    fn enable(db: &Connection) {
        db.execute("UPDATE sync_state SET history=1", []).unwrap();
    }
    fn record(ms: i64) -> listening::ListeningRecord {
        serde_json::from_value(json!({"id":uuid::Uuid::new_v4().to_string(),"trackId":"youtube:abcdefghijk","title":"Song","artist":"Artist","album":"Album","artworkUrl":null,"providerId":"youtube","sourceId":"abcdefghijk","startedAt":1760000000000_i64,"updatedAt":1760000000000_i64+ms,"listenedMs":ms,"days":{"2026-10-26":ms}})).unwrap()
    }
    fn exchange(a: &mut Connection, b: &mut Connection, history: bool) {
        let peer = state(b, false).unwrap().device_id;
        for _ in 0..100 {
            let (sent, received) = super::peer(a, &peer, history).unwrap();
            let outgoing = page(a, sent, history, 100).unwrap();
            let request = Packet {
                device_id: state(a, false).unwrap().device_id,
                since: received,
                cells: outgoing.cells,
                history,
                favorites: None,
                checkpoint: None,
            };
            let raw = handle(
                b,
                "POST /v2/sync HTTP/1.1",
                &serde_json::to_vec(&request).unwrap(),
            )
            .unwrap();
            let response: Reply = serde_json::from_slice(&raw).unwrap();
            let more = outgoing.more || response.more;
            accept(a, response, outgoing.cursor).unwrap();
            if !more {
                return;
            }
        }
        panic!("Sync did not converge");
    }
    #[test]
    fn incremental_pages_retry_lost_ack_and_both_directions_converge() {
        let mut a = db();
        let mut b = db();
        for n in 0..237 {
            local(
                &a,
                key(&["name", &format!("playlist-{n}")]),
                json!(format!("Mix {n}")),
            )
            .unwrap();
        }
        let outgoing = page(&a, 0, false, 100).unwrap();
        let packet = Packet {
            device_id: state(&a, false).unwrap().device_id,
            since: 0,
            cells: outgoing.cells,
            history: false,
            favorites: None,
            checkpoint: None,
        };
        // The server commits but its acknowledgement is lost. Reconnect resends safely.
        handle(
            &mut b,
            "POST /v2/sync HTTP/1.1",
            &serde_json::to_vec(&packet).unwrap(),
        )
        .unwrap();
        exchange(&mut a, &mut b, false);
        assert_eq!(state(&a, true).unwrap().cells.len(), 237);
        assert_eq!(state(&b, true).unwrap().cells.len(), 237);
        local(&b, key(&["deleted", "playlist-0"]), json!(true)).unwrap();
        local(&a, key(&["name", "playlist-1"]), json!("Offline rename")).unwrap();
        exchange(&mut b, &mut a, false);
        exchange(&mut a, &mut b, false);
        let canonical = |db: &Connection| {
            state(db, true)
                .unwrap()
                .cells
                .into_iter()
                .map(|c| (c.key.clone(), serde_json::to_value(c).unwrap()))
                .collect::<std::collections::BTreeMap<_, _>>()
        };
        assert_eq!(canonical(&a), canonical(&b));
        let peer = state(&b, false).unwrap().device_id;
        let (sent, _) = super::peer(&a, &peer, false).unwrap();
        assert!(page(&a, sent, false, 100).unwrap().cells.is_empty());
    }
    #[test]
    fn event_ids_deduplicate_retries_but_preserve_repeat_plays_and_updates() {
        let mut a = db();
        let mut b = db();
        enable(&a);
        enable(&b);
        let mut first = record(12000);
        let second = record(15000);
        listening::checkpoint(&mut a, 0, first.clone()).unwrap();
        listening::checkpoint(&mut a, 0, second.clone()).unwrap();
        exchange(&mut a, &mut b, true);
        exchange(&mut b, &mut a, true);
        exchange(&mut a, &mut b, true);
        assert_eq!(listening::read(&b).unwrap().records.len(), 2);
        first.listened_ms = 20000;
        first.updated_at += 8000;
        first.days.insert("2026-10-26".into(), 20000);
        listening::checkpoint(&mut a, 0, first).unwrap();
        exchange(&mut b, &mut a, true);
        let records = listening::read(&b).unwrap().records;
        assert_eq!(records.len(), 2);
        assert_eq!(records.iter().map(|r| r.listened_ms).sum::<i64>(), 35000);
    }
    #[test]
    fn clear_wins_over_offline_old_events_and_delayed_checkpoints_without_resurrection() {
        let mut a = db();
        let mut b = db();
        enable(&a);
        enable(&b);
        let row = record(12000);
        listening::checkpoint(&mut a, 0, row.clone()).unwrap();
        exchange(&mut a, &mut b, true);
        listening::clear(&mut a).unwrap();
        // An offline device still has the old epoch, even for a new play.
        listening::checkpoint(&mut b, 0, record(18000)).unwrap();
        exchange(&mut b, &mut a, true);
        exchange(&mut a, &mut b, true);
        assert!(listening::read(&a).unwrap().records.is_empty());
        assert!(listening::read(&b).unwrap().records.is_empty());
        assert!(!listening::checkpoint(&mut b, 0, row).unwrap());
        let generation = listening::read(&b).unwrap().generation;
        listening::checkpoint(&mut b, generation, record(21000)).unwrap();
        exchange(&mut a, &mut b, true);
        assert_eq!(listening::read(&a).unwrap().records.len(), 1);
    }
    #[test]
    fn concurrent_clears_converge_and_history_requires_both_opt_ins() {
        let mut a = db();
        let mut b = db();
        enable(&a);
        listening::checkpoint(&mut a, 0, record(12000)).unwrap();
        exchange(&mut a, &mut b, false);
        assert!(listening::read(&b).unwrap().records.is_empty());
        enable(&b);
        exchange(&mut a, &mut b, true);
        assert_eq!(listening::read(&b).unwrap().records.len(), 1);
        listening::clear(&mut a).unwrap();
        listening::clear(&mut b).unwrap();
        exchange(&mut a, &mut b, true);
        exchange(&mut b, &mut a, true);
        assert_eq!(epoch(&a).unwrap(), epoch(&b).unwrap());
        assert!(listening::read(&a).unwrap().records.is_empty());
        assert!(listening::read(&b).unwrap().records.is_empty());
    }
    #[test]
    fn out_of_order_event_waits_for_its_clear_marker_and_is_not_lost_in_paging() {
        let mut a = db();
        let b = db();
        enable(&a);
        enable(&b);
        listening::clear(&mut a).unwrap();
        listening::checkpoint(&mut a, 1, record(12000)).unwrap();
        let all = page(&a, 0, true, 100).unwrap().cells;
        let event = all
            .iter()
            .find(|c| c.key.starts_with("[\"history\","))
            .unwrap()
            .clone();
        let clear = all
            .iter()
            .find(|c| c.key == key(&["clear"]))
            .unwrap()
            .clone();
        merge(&b, &[event], true).unwrap();
        assert!(listening::read(&b).unwrap().records.is_empty());
        assert_eq!(page(&b, 0, true, 1).unwrap().cells.len(), 1);
        merge(&b, &[clear], true).unwrap();
        assert_eq!(listening::read(&b).unwrap().records.len(), 1);
    }
    #[test]
    fn malformed_or_interrupted_pages_never_commit_partial_state_or_advance_cursors() {
        let mut a = db();
        let mut b = db();
        local(&a, key(&["name", "mix"]), json!("Good")).unwrap();
        let mut cells = state(&a, true).unwrap().cells;
        cells.push(Cell {
            key: key(&["settings", "volume"]),
            clock: 2,
            device: state(&a, false).unwrap().device_id,
            value: json!(0),
        });
        let packet = Packet {
            device_id: state(&a, false).unwrap().device_id,
            since: 0,
            cells,
            history: false,
            favorites: None,
            checkpoint: None,
        };
        let raw = serde_json::to_vec(&packet).unwrap();
        assert!(handle(&mut b, "POST /v2/sync HTTP/1.1", &raw[..raw.len() / 2]).is_err());
        assert!(handle(&mut b, "POST /v2/sync HTTP/1.1", &raw).is_err());
        assert!(state(&b, true).unwrap().cells.is_empty());
        assert_eq!(state(&b, false).unwrap().revision, 0);
        exchange(&mut a, &mut b, false);
        assert_eq!(state(&b, true).unwrap().cells.len(), 1);
    }
    #[test]
    fn offline_state_tombstones_identity_and_cursors_survive_database_reopen() {
        let path =
            std::env::temp_dir().join(format!("lumaire-sync-{}.sqlite3", uuid::Uuid::new_v4()));
        let id;
        {
            let mut a = Connection::open(&path).unwrap();
            crate::initialize(&mut a).unwrap();
            id = state(&a, false).unwrap().device_id;
            local(&a, key(&["deleted", "mix"]), json!(true)).unwrap();
            let mut b = db();
            exchange(&mut a, &mut b, false);
        }
        {
            let mut a = Connection::open(&path).unwrap();
            crate::initialize(&mut a).unwrap();
            assert_eq!(state(&a, false).unwrap().device_id, id);
            assert_eq!(state(&a, true).unwrap().cells.len(), 1);
            assert_eq!(
                a.query_row("SELECT COUNT(*) FROM sync_peers", [], |r| r
                    .get::<_, i64>(0))
                    .unwrap(),
                1
            );
        }
        let _ = std::fs::remove_file(path);
    }

    fn favorite_track(n: usize) -> Value {
        json!({"id":format!("itunes:{n}"),"metadataSourceId":format!("itunes:{n}"),"title":"Song","artist":"Artist","album":"Album","duration":100,"format":"catalog","fileName":"C:/private/song.m4a","missing":false,"offline":true})
    }
    fn exchange_favorites(a: &mut Connection, b: &mut Connection) {
        for _ in 0..100 {
            let enabled = state(a, false).unwrap().favorites_enabled && state(b, false).unwrap().favorites_enabled;
            let (sent, received) = peer_favorites(a, &state(b, false).unwrap().device_id, false, enabled).unwrap();
            let outgoing = page_favorites(a, sent, false, enabled, 100).unwrap();
            let packet = Packet { device_id: state(a,false).unwrap().device_id, since: received, cells: outgoing.cells, history: false, favorites: Some(enabled), checkpoint: None };
            let raw = handle(b,"POST /v3/sync HTTP/1.1",&serde_json::to_vec(&packet).unwrap()).unwrap();
            let reply: Reply = serde_json::from_slice(&raw).unwrap();
            let more = outgoing.more || reply.more;
            accept(a,reply,outgoing.cursor).unwrap();
            if !more { return; }
        }
        panic!("Favorites did not converge");
    }
    fn canonical(db: &Connection) -> std::collections::BTreeMap<String, Value> {
        state(db,true).unwrap().cells.into_iter().map(|c|(c.key.clone(),serde_json::to_value(c).unwrap())).collect()
    }
    #[test]
    fn favorites_default_on_migration_and_legacy_wire_shapes_stay_compatible() {
        let mut a = db();
        a.execute("ALTER TABLE sync_state DROP COLUMN favorites",[]).unwrap();
        initialize(&a).unwrap(); initialize(&a).unwrap();
        assert!(state(&a,false).unwrap().favorites_enabled);
        local(&a,key(&["fav-track","itunes:1"]),favorite_track(1)).unwrap();
        local(&a,key(&["name","mix"]),json!("Mix")).unwrap();
        let old_hello: Value = serde_json::from_slice(&handle(&mut a,"GET /v2/hello HTTP/1.1",b"").unwrap()).unwrap();
        assert!(old_hello.get("favoritesEnabled").is_none());
        assert!(!serde_json::from_value::<State>(old_hello).unwrap().favorites_enabled);
        let hello: State = serde_json::from_slice(&handle(&mut a,"GET /v3/hello HTTP/1.1",b"").unwrap()).unwrap();
        assert!(hello.favorites_enabled);
        let mut b = db();
        exchange(&mut b,&mut a,false);
        assert_eq!(state(&b,true).unwrap().cells.len(),1);
        let legacy_reply = serde_json::to_value(page(&a,0,false,100).unwrap()).unwrap();
        assert!(legacy_reply.get("favorites").is_none());
        assert_eq!(legacy_reply["cells"].as_array().unwrap().len(),1);
        exchange_favorites(&mut b,&mut a);
        assert_eq!(canonical(&a),canonical(&b));
    }
    #[test]
    fn favorites_paginate_retry_converge_and_keep_explicit_unlike_and_relike() {
        let mut a = db(); let mut b = db();
        for n in 1..=205 { local(&a,key(&["fav-track",&format!("itunes:{n}")]),favorite_track(n)).unwrap(); }
        local(&b,key(&["fav-artist","saavn:artist:12"]),json!({"id":"saavn:artist:12","name":"Artist","artworkUrl":"file:///private"})).unwrap();
        local(&b,key(&["fav-album","saavn:album:34"]),json!({"id":"saavn:album:34","title":"Album","artist":"Artist"})).unwrap();
        exchange_favorites(&mut a,&mut b); exchange_favorites(&mut b,&mut a);
        assert_eq!(canonical(&a),canonical(&b));
        assert_eq!(canonical(&a).len(),207);
        assert!(!serde_json::to_string(&canonical(&b)).unwrap().contains("private"));
        let stale = state(&a,true).unwrap().cells;
        for (kind,id) in [("fav-track","itunes:1"),("fav-artist","saavn:artist:12"),("fav-album","saavn:album:34")] {
            local(&b,key(&[kind,id]),json!(false)).unwrap();
        }
        exchange_favorites(&mut a,&mut b);
        merge(&a,&stale,false).unwrap();
        assert_eq!(get(&a,&key(&["fav-track","itunes:1"])).unwrap().unwrap().value,false);
        local(&a,key(&["fav-track","itunes:1"]),favorite_track(1)).unwrap();
        exchange_favorites(&mut b,&mut a); exchange_favorites(&mut a,&mut b);
        assert_eq!(canonical(&a),canonical(&b));
        assert!(get(&b,&key(&["fav-track","itunes:1"])).unwrap().unwrap().value.is_object());
    }
    #[test]
    fn favorites_require_both_toggles_and_reset_cursors_after_mode_changes() {
        let mut a = db(); let mut b = db();
        local(&a,key(&["fav-track","itunes:1"]),favorite_track(1)).unwrap();
        b.execute("UPDATE sync_state SET favorites=0",[]).unwrap();
        exchange_favorites(&mut a,&mut b);
        assert!(state(&b,true).unwrap().cells.is_empty());
        b.execute("UPDATE sync_state SET favorites=1",[]).unwrap();
        exchange_favorites(&mut a,&mut b);
        assert_eq!(canonical(&a),canonical(&b));
        b.execute("UPDATE sync_state SET favorites=0",[]).unwrap();
        local(&b,key(&["fav-track","itunes:1"]),json!(false)).unwrap();
        exchange_favorites(&mut a,&mut b);
        assert!(get(&a,&key(&["fav-track","itunes:1"])).unwrap().unwrap().value.is_object());
        b.execute("UPDATE sync_state SET favorites=1",[]).unwrap();
        exchange_favorites(&mut a,&mut b);
        assert_eq!(get(&a,&key(&["fav-track","itunes:1"])).unwrap().unwrap().value,false);
    }
    #[test]
    fn malformed_favorites_rollback_the_entire_page() {
        let a = db(); let mut b = db();
        let device = state(&a,false).unwrap().device_id;
        for (kind,id,value) in [
            ("fav-track","itunes:2",favorite_track(1)),
            ("fav-track","itunes:1",json!(true)),
            ("fav-artist","saavn:artist:12",json!({"id":"saavn:artist:13","name":"Wrong"})),
            ("fav-album","file:///secret",json!({"id":"file:///secret","title":"Bad","artist":"Bad"})),
        ] {
            let packet = Packet { device_id:device.clone(),since:0,history:false,favorites:Some(true),checkpoint:None,cells:vec![
                Cell{key:key(&["name","mix"]),clock:1,device:device.clone(),value:json!("Mix")},
                Cell{key:key(&[kind,id]),clock:2,device:device.clone(),value},
            ]};
            assert!(handle(&mut b,"POST /v3/sync HTTP/1.1",&serde_json::to_vec(&packet).unwrap()).is_err());
            assert!(canonical(&b).is_empty()); assert_eq!(state(&b,false).unwrap().revision,0);
        }
    }
}


#[cfg(test)]
#[path = "device_sync_checkpoint_tests.rs"]
mod checkpoint_tests;
