use serde_json::Value;

// Native queue ownership must not overwrite unrelated library edits from the renderer.
pub(crate) fn merge(mut session: Value, native: &Value) -> Value {
    if native["nativeQueueEpoch"] != session["nativeQueueEpoch"] || native["nativeQueueRevision"].as_u64().unwrap_or(0) > session["nativeQueueRevision"].as_u64().unwrap_or(0) {
        for key in ["queue", "queueTracks", "currentId", "position", "shuffleOrder", "nativeQueueRevision", "nativeQueueEpoch", "nativePositionAt"] {
            session[key] = native[key].clone();
        }
    } else if native["nativeQueueRevision"] == session["nativeQueueRevision"] && native["currentId"] == session["currentId"]
        && native["nativePositionAt"].as_u64().unwrap_or(0) > session["nativePositionAt"].as_u64().unwrap_or(0) {
        session["position"] = native["position"].clone();
        session["nativePositionAt"] = native["nativePositionAt"].clone();
    }
    session
}

#[cfg(test)]
mod tests {
    use super::merge;
    use serde_json::json;
    #[test]
    fn stale_renderer_saves_preserve_native_progress_and_current_library_edits() {
        let incoming = json!({"nativeQueueRevision":1,"currentId":"a","queue":["a"],"position":3,"playlists":["new playlist"],"favorites":["favorite"],"lyrics":{"a":"edited lyrics"}});
        let native = json!({"nativeQueueRevision":2,"currentId":"b","queue":["a","b"],"queueTracks":{},"shuffleOrder":[],"position":12,"nativePositionAt":100});
        let result = merge(incoming, &native);
        assert_eq!(result["currentId"], "b");
        assert_eq!(result["position"], 12);
        assert_eq!(result["playlists"], json!(["new playlist"]));
        assert_eq!(result["favorites"], json!(["favorite"]));
        assert_eq!(result["lyrics"]["a"], "edited lyrics");
    }
    #[test]
    fn newer_seek_and_queue_edits_are_not_replaced_by_older_progress() {
        let native = json!({"nativeQueueRevision":2,"currentId":"b","position":12,"nativePositionAt":100});
        let incoming = json!({"nativeQueueRevision":2,"currentId":"b","queue":["b","user addition"],"position":30,"nativePositionAt":110});
        assert_eq!(merge(incoming.clone(), &native), incoming);
        let incoming = json!({"nativeQueueRevision":2,"currentId":"b","queue":["b","user addition"],"position":3,"nativePositionAt":90});
        let result = merge(incoming, &native);
        assert_eq!(result["position"], 12);
        assert_eq!(result["queue"], json!(["b","user addition"]));
    }
    #[test]
    fn a_new_service_epoch_replaces_restored_device_counters() {
        let incoming = json!({"nativeQueueEpoch":"previous service","nativeQueueRevision":999,"currentId":"a"});
        let native = json!({"nativeQueueEpoch":"current service","nativeQueueRevision":1,"currentId":"b"});
        assert_eq!(merge(incoming, &native)["currentId"], "b");
    }
}
