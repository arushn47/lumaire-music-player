//! Native-service access to the existing library/provider boundary; no renderer is required.
use jni::{objects::{JClass, JString}, sys::{jboolean, jstring}, JNIEnv};
use serde_json::{json, Value};
use std::sync::{Mutex, OnceLock};
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::{AppHandle, Manager};
use rusqlite::OptionalExtension;

static APP: Mutex<Option<AppHandle>> = Mutex::new(None);
static QUEUE: Mutex<Option<Value>> = Mutex::new(None);
static GENERATION: AtomicU64 = AtomicU64::new(0);
static PLAYBACK_ACTIVE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
static DOWNLOAD_ACTIVE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
static RUNTIME: OnceLock<tokio::runtime::Runtime> = OnceLock::new();

pub fn install(app: AppHandle) { *APP.lock().unwrap_or_else(|e| e.into_inner()) = Some(app); }

pub fn keep_process_alive() -> bool {
    PLAYBACK_ACTIVE.load(Ordering::SeqCst) || DOWNLOAD_ACTIVE.load(Ordering::SeqCst)
}

#[no_mangle]
pub extern "system" fn Java_app_lumaire_player_NativeQueueBridge_downloadActivity(_env: JNIEnv, _class: JClass, active: jboolean) {
    DOWNLOAD_ACTIVE.store(active != 0, Ordering::SeqCst);
}

#[no_mangle]
pub extern "system" fn Java_app_lumaire_player_NativeQueueBridge_reopenWindow(_env: JNIEnv, _class: JClass) {
    let app = APP.lock().unwrap_or_else(|e| e.into_inner()).clone();
    if let Some(app) = app {
        // The service keeps Rust alive after Activity destruction; attach the replacement Activity.
        std::thread::spawn(move || {
            if app.get_webview_window("main").is_none() {
                if let Some(config) = app.config().app.windows.first() {
                    let result = tauri::WebviewWindowBuilder::from_config(&app, config).and_then(|window| window.build());
                    if result.is_err() { eprintln!("Could not reopen the player window."); }
                }
            }
        });
    }
}

pub fn merge_session(session: Value) -> Value {
    if let Some(native) = QUEUE.lock().unwrap_or_else(|e| e.into_inner()).as_ref() {
        return crate::android_queue_state::merge(session, native);
    }
    session
}

async fn dispatch(request: Value) -> crate::Result<Value> {
    let app = APP.lock().unwrap_or_else(|e| e.into_inner()).clone().ok_or("Open Lumaire once before resuming playback.")?;
    let args = &request["args"];
    let text = |key: &str| args[key].as_str().filter(|s| s.len() <= 8192).map(str::to_owned).ok_or_else(|| "Invalid background request.".to_string());
    match request["method"].as_str().unwrap_or("") {
        "lookup" => serde_json::to_value(crate::catalog::lookup_catalog(text("id")?).await?).map_err(crate::err),
        "catalogSearch" => serde_json::to_value(crate::catalog::search_catalog(text("query")?, Some(args["limit"].as_u64().unwrap_or(5).min(30) as u32)).await?).map_err(crate::err),
        "recommendations" => serde_json::to_value(crate::catalog::recommend_catalog(text("id")?).await?).map_err(crate::err),
        "verified" => {
            let value = crate::get_verified_source_inner(app, text("id")?).await?;
            Ok(value.map(|s| json!({"id":s.source_id,"title":s.title,"channel":s.artist,"duration":s.duration,"thumbnail":null,"userSelected":s.user_selected})).unwrap_or(Value::Null))
        }
        "remember" => {
            let source = &args["source"];
            crate::android::validate_video_id(source["id"].as_str().ok_or("Missing source identity.")?)?;
            crate::set_verified_source_inner(app, text("id")?, crate::VerifiedSource {
                user_selected: false,
                source_id: source["id"].as_str().unwrap().into(), source_provider: "youtube".into(),
                title: source["title"].as_str().unwrap_or("").into(), artist: source["channel"].as_str().map(str::to_owned),
                duration: source["duration"].as_f64(),
            }).await?;
            Ok(Value::Null)
        }
        "media" => {
            let path = crate::media_path_inner(app, text("id")?).await?;
            Ok(json!(reqwest::Url::from_file_path(path).map_err(|_| "Invalid local audio path.")?.to_string()))
        }
        "commons" => Ok(json!(crate::resolve_commons_audio_inner(text("id")?).await?.url)),
        "commit" => {
            let session = args["session"].clone();
            crate::validate_session(&session)?;
            let owner = request["generation"].as_u64();
            crate::work(app, move |_, db| {
                if owner.is_some_and(|owner| GENERATION.load(Ordering::SeqCst) != owner) { return Err("Playback selection changed.".into()); }
                let tx = db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate).map_err(crate::err)?;
                let raw: Option<String> = tx.query_row("SELECT data FROM app_state WHERE id=1", [], |row| row.get(0)).optional().map_err(crate::err)?;
                let mut latest = raw.map(|raw| serde_json::from_str(&raw)).transpose().map_err(crate::err)?.unwrap_or_else(|| session.clone());
                for key in ["queue", "queueTracks", "currentId", "position", "shuffleOrder", "nativeQueueRevision", "nativeQueueEpoch", "nativePositionAt"] {
                    latest[key] = session[key].clone();
                }
                crate::write_session_transaction(&tx, &latest)?;
                tx.commit().map_err(crate::err)?;
                *QUEUE.lock().unwrap_or_else(|e| e.into_inner()) = Some(session);
                PLAYBACK_ACTIVE.store(true, Ordering::SeqCst);
                Ok(())
            }).await?;
            Ok(Value::Null)
        }
        "clear" => {
            *QUEUE.lock().unwrap_or_else(|e| e.into_inner()) = None;
            PLAYBACK_ACTIVE.store(false, Ordering::SeqCst);
            Ok(Value::Null)
        }
        "historyCheckpoint" => {
            let record = serde_json::from_value(args["record"].clone()).map_err(crate::err)?;
            let generation = args["generation"].as_i64().ok_or("Invalid listening generation.")?;
            Ok(json!(crate::listening::checkpoint_listening(app, generation, record).await?))
        }
        _ => Err("Unsupported background operation.".into()),
    }
}

// Called only from the service's worker thread, never Android's main thread.
#[no_mangle]
pub extern "system" fn Java_app_lumaire_player_NativeQueueBridge_call(mut env: JNIEnv, _class: JClass, input: JString) -> jstring {
    let response = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| -> crate::Result<Value> {
        let input: String = env.get_string(&input).map_err(crate::err)?.into();
        if input.len() > 20 * 1024 * 1024 { return Err("Background request is too large.".into()); }
        let request: Value = serde_json::from_str(&input).map_err(crate::err)?;
        let owner = request["generation"].as_u64();
        let runtime = RUNTIME.get_or_init(|| tokio::runtime::Builder::new_multi_thread().worker_threads(2).enable_all().build().expect("native provider runtime"));
        runtime.block_on(async {
            if let Some(owner) = owner {
                if GENERATION.load(Ordering::SeqCst) != owner { return Err("Playback selection changed.".into()); }
                tokio::select! {
                    result = dispatch(request) => result,
                    _ = async {
                        loop {
                            tokio::time::sleep(std::time::Duration::from_millis(25)).await;
                            if GENERATION.load(Ordering::SeqCst) != owner { break; }
                        }
                    } => Err("Playback selection changed.".into()),
                }
            } else { dispatch(request).await }
        })
    }));
    let value = match response {
        Ok(Ok(value)) => json!({"ok":true,"value":value}),
        Ok(Err(error)) => json!({"ok":false,"error":error}),
        Err(_) => json!({"ok":false,"error":"Background playback operation failed."}),
    };
    env.new_string(value.to_string()).map(|s| s.into_raw()).unwrap_or(std::ptr::null_mut())
}

#[no_mangle]
pub extern "system" fn Java_app_lumaire_player_NativeQueueBridge_cancel(_env: JNIEnv, _class: JClass, generation: jni::sys::jlong) {
    GENERATION.store(generation as u64, Ordering::SeqCst);
}
