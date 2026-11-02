package app.lumaire.player

/** Existing Rust providers and SQLite remain the only library boundary. */
@androidx.annotation.Keep
object NativeQueueBridge {
    @JvmStatic external fun call(request: String): String
    @JvmStatic external fun cancel(generation: Long)
    @JvmStatic external fun reopenWindow()
    @JvmStatic external fun downloadActivity(active: Boolean)
}
