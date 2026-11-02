fn main() {
    // Tauri supplies Android RUSTFLAGS itself; apply page alignment at the final
    // cdylib link so Windows flags and existing desktop builds stay unchanged.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("android") {
        println!("cargo:rustc-link-arg-cdylib=-Wl,-z,max-page-size=16384");
    }
    tauri_build::try_build(tauri_build::Attributes::new().plugin(
        "lumaire-android",
        tauri_build::InlinedPlugin::new().commands(&["navigation", "register_listener", "remove_listener", "downloadNotification"]),
    )).expect("Failed to build Lumaire platform permissions")
}
