#[cfg(test)]
mod checkpoint_tests {
    use super::super::*;

    fn test_checkpoint() -> PlaybackCheckpoint {
        PlaybackCheckpoint {
            version: 1,
            id: uuid::Uuid::new_v4().to_string(),
            device_id: uuid::Uuid::new_v4().to_string(),
            device_name: Some("Test Device".into()),
            captured_at: 1735689600000, // 2025-01-01
            playing: true,
            current_entry_id: Some("entry1".into()),
            position: 42.5,
            queue: vec![CheckpointQueueEntry {
                id: "entry1".into(),
                track_id: "saavn:abc12345".into(),
                metadata: crate::Track {
                    id: "saavn:abc12345".into(),
                    title: "Test Song".into(),
                    artist: "Test Artist".into(),
                    album: "Test Album".into(),
                    duration: 180.0,
                    file_name: String::new(),
                    missing: false,
                    format: "catalog".into(),
                    source: None,
                    artwork_url: None,
                    metadata_source_id: Some("saavn:abc12345".into()),
                    offline: false,
                    recording_metadata: None,
                },
                requested: None,
            }],
            shuffle_order: vec!["entry1".into()],
            shuffle: false,
            repeat: "off".into(),
            playlist_id: None,
            playlist_name: None,
        }
    }

    #[test]
    fn checkpoint_validation_accepts_valid() {
        let mut cp = test_checkpoint();
        assert!(validate_checkpoint(&mut cp).is_ok());
    }

    #[test]
    fn checkpoint_validation_rejects_wrong_version() {
        let mut cp = test_checkpoint();
        cp.version = 99;
        assert!(validate_checkpoint(&mut cp).is_err());
    }

    #[test]
    fn checkpoint_validation_rejects_invalid_device_id() {
        let mut cp = test_checkpoint();
        cp.device_id = "not-a-uuid".into();
        assert!(validate_checkpoint(&mut cp).is_err());
    }

    #[test]
    fn checkpoint_validation_rejects_negative_position() {
        let mut cp = test_checkpoint();
        cp.position = -5.0;
        assert!(validate_checkpoint(&mut cp).is_err());
    }

    #[test]
    fn checkpoint_validation_rejects_excessive_position() {
        let mut cp = test_checkpoint();
        cp.position = 90000.0;
        assert!(validate_checkpoint(&mut cp).is_err());
    }

    #[test]
    fn checkpoint_validation_rejects_invalid_repeat() {
        let mut cp = test_checkpoint();
        cp.repeat = "invalid".into();
        assert!(validate_checkpoint(&mut cp).is_err());
    }

    #[test]
    fn checkpoint_validation_rejects_empty_queue() {
        let mut cp = test_checkpoint();
        cp.queue.clear();
        assert!(validate_checkpoint(&mut cp).is_err());
    }

    #[test]
    fn checkpoint_validation_rejects_oversized_queue() {
        let mut cp = test_checkpoint();
        cp.queue = (0..250)
            .map(|i| CheckpointQueueEntry {
                id: format!("entry{}", i),
                track_id: format!("saavn:track{:06}", i),
                metadata: crate::Track {
                    id: format!("saavn:track{:06}", i),
                    title: format!("Song {}", i),
                    artist: "Artist".into(),
                    album: "Album".into(),
                    duration: 180.0,
                    file_name: String::new(),
                    missing: false,
                    format: "catalog".into(),
                    source: None,
                    artwork_url: None,
                    metadata_source_id: Some(format!("saavn:track{:06}", i)),
                    offline: false,
                    recording_metadata: None,
                },
                requested: None,
            })
            .collect();
        assert!(validate_checkpoint(&mut cp).is_err());
    }

    #[test]
    fn checkpoint_save_and_retrieve() {
        let db = super::super::tests::db();
        let cp = test_checkpoint();
        let device_id = cp.device_id.clone();
        
        // Save checkpoint
        let value = serde_json::to_value(&cp).unwrap();
        save_playback_checkpoint_impl(&db, value).unwrap();
        
        // Retrieve checkpoints
        let result = get_playback_checkpoints_impl(&db).unwrap();
        
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].device_id, device_id);
        assert_eq!(result[0].position, 42.5);
    }

    #[test]
    fn checkpoint_newer_replaces_older() {
        let db = super::super::tests::db();
        let mut cp1 = test_checkpoint();
        cp1.captured_at = 1000;
        cp1.position = 10.0;
        
        let mut cp2 = test_checkpoint();
        cp2.device_id = cp1.device_id.clone();
        cp2.captured_at = 2000;
        cp2.position = 20.0;
        
        // Save older checkpoint
        let value1 = serde_json::to_value(&cp1).unwrap();
        save_playback_checkpoint_impl(&db, value1).unwrap();
        
        // Save newer checkpoint
        let value2 = serde_json::to_value(&cp2).unwrap();
        save_playback_checkpoint_impl(&db, value2).unwrap();
        
        // Verify newer checkpoint is stored
        let result = get_playback_checkpoints_impl(&db).unwrap();
        
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].captured_at, 2000);
        assert_eq!(result[0].position, 20.0);
    }

    #[test]
    fn checkpoint_older_does_not_replace_newer() {
        let db = super::super::tests::db();
        let mut cp1 = test_checkpoint();
        cp1.captured_at = 2000;
        cp1.position = 20.0;
        
        let mut cp2 = test_checkpoint();
        cp2.device_id = cp1.device_id.clone();
        cp2.captured_at = 1000;
        cp2.position = 10.0;
        
        // Save newer checkpoint first
        let value1 = serde_json::to_value(&cp1).unwrap();
        save_playback_checkpoint_impl(&db, value1).unwrap();
        
        // Try to save older checkpoint
        let value2 = serde_json::to_value(&cp2).unwrap();
        save_playback_checkpoint_impl(&db, value2).unwrap();
        
        // Verify newer checkpoint is still stored
        let result = get_playback_checkpoints_impl(&db).unwrap();
        
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].captured_at, 2000);
        assert_eq!(result[0].position, 20.0);
    }

    #[test]
    fn checkpoint_delete() {
        let db = super::super::tests::db();
        let cp = test_checkpoint();
        let device_id = cp.device_id.clone();
        
        // Save checkpoint
        let value = serde_json::to_value(&cp).unwrap();
        save_playback_checkpoint_impl(&db, value).unwrap();
        
        // Delete checkpoint
        delete_playback_checkpoint_impl(&db, device_id.clone()).unwrap();
        
        // Verify deletion
        let result = get_playback_checkpoints_impl(&db).unwrap();
        
        assert_eq!(result.len(), 0);
    }

    // Helper functions that don't use AppHandle
    fn save_playback_checkpoint_impl(db: &Connection, checkpoint: serde_json::Value) -> Result<()> {
        let mut cp: PlaybackCheckpoint = serde_json::from_value(checkpoint)
            .map_err(|e| format!("Invalid checkpoint format: {}", e))?;
        
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
             updated_at=excluded.updated_at
             WHERE excluded.captured_at >= playback_checkpoints.captured_at",
            params![
                cp.device_id,
                serialized,
                cp.captured_at,
                now_ms
            ],
        )
        .map_err(err)?;
        
        Ok(())
    }

    fn get_playback_checkpoints_impl(db: &Connection) -> Result<Vec<PlaybackCheckpoint>> {
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
    }

    fn delete_playback_checkpoint_impl(db: &Connection, device_id: String) -> Result<()> {
        db.execute(
            "DELETE FROM playback_checkpoints WHERE device_id=?1",
            [device_id],
        )
        .map_err(err)?;
        Ok(())
    }
}
