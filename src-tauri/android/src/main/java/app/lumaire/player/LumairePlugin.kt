package app.lumaire.player

import android.app.Activity
import android.content.ComponentName
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import android.view.inputmethod.InputMethodManager
import android.webkit.WebView
import android.widget.Toast
import androidx.activity.result.ActivityResult
import androidx.core.content.ContextCompat
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Player
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.Executors

@TauriPlugin
class LumairePlugin(private var activity: Activity) : Plugin(activity) {
    private var destroyed = false
    private var webView: WebView? = null
    private var notificationPermissionRequested = false
    override fun load(webView: WebView) { this.webView = webView }
    override fun onResume(activity: androidx.appcompat.app.AppCompatActivity) {
        if (destroyed) {
            this.activity = activity
            destroyed = false
            io = Executors.newSingleThreadExecutor()
            NativeQueueBridge.reopenWindow()
        }
    }
    override fun onDestroy(activity: androidx.appcompat.app.AppCompatActivity) {
        destroyed = true
        controller?.removeListener(playbackListener); controller?.release(); controller = null
        webView = null
        waiting.clear()
        io.shutdown()
    }

    @Command
    fun navigation(invoke: Invoke) {
        val action = invoke.getArgs().optString("action")
        activity.runOnUiThread {
            when (action) {
                "minimize" -> activity.moveTaskToBack(true)
                "backHint" -> Toast.makeText(activity, "Press Back again to minimize Lumaire", Toast.LENGTH_SHORT).show()
                "keyboard" -> webView?.let {
                    it.requestFocus()
                    activity.getSystemService(InputMethodManager::class.java).showSoftInput(it, InputMethodManager.SHOW_IMPLICIT)
                }
                "finishForTest" -> if (BuildConfig.DEBUG) { invoke.resolve(); activity.finish(); return@runOnUiThread }
                    else { invoke.reject("Test navigation is unavailable."); return@runOnUiThread }
                else -> { invoke.reject("Unknown navigation action."); return@runOnUiThread }
            }
            invoke.resolve()
        }
    }

    @Command
    fun downloadNotification(invoke: Invoke) {
        val args = invoke.getArgs()
        val active = args.optBoolean("active", false)
        val title = args.optString("title", "Downloading audio")
        val done = args.optInt("done", 0)
        val total = args.optInt("total", 0)

        try {
            NativeQueueBridge.downloadActivity(active)
            if (active && android.os.Build.VERSION.SDK_INT >= 33 &&
                !notificationPermissionRequested && ContextCompat.checkSelfPermission(activity, android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                notificationPermissionRequested = true
                activity.requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), 1002)
            }
            val intent = Intent(activity, DownloadForegroundService::class.java).apply {
                action = if (active) DownloadForegroundService.UPDATE else DownloadForegroundService.STOP
                putExtra(DownloadForegroundService.TITLE, title)
                putExtra(DownloadForegroundService.DONE, done)
                putExtra(DownloadForegroundService.TOTAL, total)
            }
            if (active) ContextCompat.startForegroundService(activity, intent)
            else activity.startService(intent)
            invoke.resolve()
        } catch (error: Exception) {
            invoke.reject(error.message ?: "Could not keep Android downloads running in the background.")
        }
    }
    private var controller: MediaController? = null
    private val resolver = ResolverClient.shared(activity.applicationContext)
    private var io = Executors.newSingleThreadExecutor()
    private var connecting = false
    private val waiting = mutableListOf<Pair<Invoke, (MediaController) -> Unit>>()
    private val playbackListener = object : Player.Listener {
        override fun onEvents(player: Player, events: Player.Events) {
            if (destroyed) return
            if (events.contains(Player.EVENT_PLAYER_ERROR) && player.playerError != null) resolver.invalidate()
            // Native completion/error events bypass hidden WebView timer throttling.
            if (events.containsAny(Player.EVENT_PLAYBACK_STATE_CHANGED, Player.EVENT_IS_PLAYING_CHANGED,
                    Player.EVENT_PLAYER_ERROR, Player.EVENT_PLAY_WHEN_READY_CHANGED)) {
                controller?.let { trigger("playback", state(it)) }
            }
        }
    }

    private fun withPlayer(invoke: Invoke, operation: (MediaController) -> Unit) {
        activity.runOnUiThread {
            if (destroyed) { invoke.reject("The player window closed."); return@runOnUiThread }
            val active = controller
            if (active != null) { operation(active); return@runOnUiThread }
            waiting.add(Pair(invoke, operation))
            if (connecting) return@runOnUiThread
            connecting = true
            val future = MediaController.Builder(activity,
                SessionToken(activity, ComponentName(activity, PlaybackService::class.java))).buildAsync()
            future.addListener({
                connecting = false
                val pending = waiting.toList(); waiting.clear()
                try {
                    val player = future.get()
                    if (destroyed) { player.release(); return@addListener }
                    controller = player
                    player.addListener(playbackListener)
                    pending.forEach { (request, action) ->
                        try { action(player) } catch (_: Exception) { request.reject("Playback action failed.") }
                    }
                } catch (_: Exception) {
                    pending.forEach { (request, _) -> request.reject("Could not connect to Android audio playback.") }
                }
            }, ContextCompat.getMainExecutor(activity))
        }
    }

    private fun state(player: MediaController): JSObject = JSObject().apply {
        val queue = PlaybackService.active?.queue
        val failure = player.playerError
        put("status", when {
            failure != null -> "error"
            player.playbackState == Player.STATE_ENDED -> "ended"
            player.playbackState == Player.STATE_BUFFERING -> "buffering"
            player.isPlaying -> "playing"
            player.mediaItemCount == 0 -> "idle"
            else -> "paused"
        })
        put("time", player.currentPosition.coerceAtLeast(0).toDouble() / 1000)
        put("duration", if (player.duration == C.TIME_UNSET) 0.0 else player.duration.coerceAtLeast(0).toDouble()/1000)
        val http = failure?.let { generateSequence(it.cause) { cause -> cause.cause }
            .filterIsInstance<androidx.media3.datasource.HttpDataSource.InvalidResponseCodeException>().firstOrNull() }
        put("error", if (failure != null) "Android could not play this audio (${http?.let { "HTTP ${it.responseCode}" } ?: failure.errorCodeName}). Try the source again." else org.json.JSONObject.NULL)
        put("id", player.currentMediaItem?.mediaId ?: "")
        if (PlaybackService.listenedTrackId == player.currentMediaItem?.mediaId) {
            put("nativeListenedMs", PlaybackService.listenedMs)
        }
        put("seekable", player.isCurrentMediaItemSeekable)
        put("nativeStateAt", android.os.SystemClock.elapsedRealtime())
        put("nativeHistoryRevision", queue?.historyVersion ?: 0L)
        put("nativeQueueRevision", queue?.version ?: 0L)
        put("nativeQueueEpoch", queue?.epoch)
        queue?.snapshot()?.let { put("nativeQueue", it) }
        if (queue?.busy == true) { put("status", "loading"); queue.selectedTrackId?.let { put("id", it) } }
        queue?.error?.let { put("status", "error"); put("error", it) }
        put("autoplay", player.playWhenReady)
        val pending = WidgetUpdateHelper.consumePendingAction()
        if (pending != null) {
            put("pendingAction", pending)
        }
    }

    @Command
    fun debugMediaRefusal(invoke: Invoke) {
        if (!BuildConfig.DEBUG) { invoke.reject("Test transport is unavailable."); return }
        ScopedHttpHeaders.debugRefuseNext(); invoke.resolve()
    }

    @Command
    fun invalidateQueue(invoke: Invoke) {
        activity.runOnUiThread { PlaybackService.active?.queue?.invalidate(); invoke.resolve() }
    }

    @Command
    fun startBackgroundQueue(invoke: Invoke) {
        if (!BuildConfig.HAS_ANDROID_STREAMING) { invoke.reject("Native queue runtime unavailable."); return }
        withPlayer(invoke) { player ->
            val args = invoke.getArgs()
            try {
                ContextCompat.startForegroundService(activity, Intent(activity, PlaybackService::class.java))
                PlaybackService.active?.queue?.start(args.getJSONObject("queue"), args.optBoolean("autoplay", true), args.optDouble("position", 0.0))
                invoke.resolve(state(player))
            } catch (_: Exception) { invoke.reject("Background playback could not start. Reopen the player and try again.") }
        }
    }

    @Command
    fun backgroundQueue(invoke: Invoke) {
        withPlayer(invoke) { player ->
            val args = invoke.getArgs()
            val accepted = BuildConfig.HAS_ANDROID_STREAMING && PlaybackService.active?.queue?.accept(args.getJSONObject("queue"), args.optLong("revision", -1)) == true
            invoke.resolve(state(player).apply { put("accepted", accepted) })
        }
    }

    @Command
    fun playback(invoke: Invoke) {
        val args = invoke.getArgs()
        withPlayer(invoke) { player ->
            when (args.getString("action")) {
                "load" -> {
                    val uri = Uri.parse(args.getString("uri"))
                    // The only caller is the Rust adapter, which resolves stored IDs.
                    require(uri.scheme == "file" || uri.scheme == "https")
                    ScopedHttpHeaders.register(uri, args.optJSONObject("headers"))
                    val artString = args.optString("artwork")
                    val meta = MediaMetadata.Builder()
                        .setTitle(args.getString("title"))
                        .setArtist(args.getString("artist"))
                    if (!artString.isNullOrBlank()) {
                        try { meta.setArtworkUri(Uri.parse(artString)) } catch (_: Exception) {}
                    }
                    val media = MediaItem.Builder().setMediaId(args.getString("id") ?: "")
                        .setUri(uri).setMediaMetadata(meta.build()).build()
                    player.setMediaItem(media, (args.optDouble("position", 0.0)*1000).toLong())
                    player.prepare()
                    player.playWhenReady = args.optBoolean("autoplay", false)
                    WidgetUpdateHelper.updateTrackInfo(activity, args.getString("title"), args.getString("artist"), artString)
                }
                "play" -> player.play()
                "pause" -> player.pause()
                "seek" -> player.seekTo((args.optDouble("value", 0.0)*1000).toLong())
                "volume" -> player.volume = args.optDouble("value", 1.0).toFloat().coerceIn(0f, 1f)
                "stop" -> { player.stop(); player.clearMediaItems() }
                "state" -> {}
                else -> { invoke.reject("Unknown audio command."); return@withPlayer }
            }
            invoke.resolve(state(player))
        }
    }

    @Command
    fun setLyrics(invoke: Invoke) {
        val args = invoke.getArgs()
        val trackId = args.getString("trackId") ?: ""
        val linesArray = args.optJSONArray("lines")
        val parsedLines = mutableListOf<NativeLyricLine>()
        if (linesArray != null) {
            for (i in 0 until linesArray.length()) {
                val item = linesArray.optJSONObject(i) ?: continue
                val time = if (item.has("time") && !item.isNull("time")) item.optLong("time") else null
                val text = item.optString("text", "")
                if (time != null && text.isNotBlank()) {
                    parsedLines.add(NativeLyricLine(time, text))
                }
            }
        }
        activity.runOnUiThread {
            WidgetUpdateHelper.setLyrics(activity, trackId, parsedLines)
            invoke.resolve()
        }
    }

    @Command
    fun setTheme(invoke: Invoke) {
        val args = invoke.getArgs()
        val themeMode = args.optString("themeMode", "dark")
        val accentColor = args.optString("accentColor", "#C4DCA3")
        activity.runOnUiThread {
            WidgetUpdateHelper.setTheme(activity, themeMode, accentColor)
            invoke.resolve()
        }
    }

    @Command
    fun resolveSource(invoke: Invoke) {
        val args = invoke.getArgs()
        if (args.optString("operation") == "probe") {
            // Availability must not start/cancel the single active resolver.
            // A restored local track can load concurrently during app startup.
            val wheels = activity.assets.list("python-wheels").orEmpty().toSet()
            val available = BuildConfig.HAS_ANDROID_STREAMING &&
                File(activity.applicationInfo.nativeLibraryDir, "libqjs.so").isFile &&
                wheels.contains("yt_dlp-2026.8.19-py3-none-any.whl") &&
                wheels.contains("yt_dlp_ejs-0.8.0-py3-none-any.whl")
            invoke.resolve(JSObject().apply { put("available", available) })
            return
        }
        activity.runOnUiThread {
            resolver.request(args) { result, error ->
                if (destroyed) return@request
                if (error != null) invoke.reject(error) else invoke.resolve(JSObject(result.toString()))
            }
        }
    }

    @Command
    fun cancelResolution(invoke: Invoke) {
        activity.runOnUiThread { resolver.cancel(); invoke.resolve() }
    }

    @Command
    fun resolverDiagnostics(invoke: Invoke) {
        activity.runOnUiThread {
            if (!BuildConfig.DEBUG) invoke.reject("Resolver diagnostics require a debug build.")
            else {
                val stats = activity.getSystemService(android.app.usage.StorageStatsManager::class.java)
                    .queryStatsForPackage(android.os.storage.StorageManager.UUID_DEFAULT, activity.packageName, android.os.Process.myUserHandle())
                invoke.resolve(JSObject(resolver.lastDiagnostic.toString()).apply {
                    put("installedAppBytes", stats.appBytes); put("dataBytes", stats.dataBytes); put("cacheBytes", stats.cacheBytes)
                })
            }
        }
    }

    @Command
    fun pickAudio(invoke: Invoke) {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            type = "audio/*"
            addCategory(Intent.CATEGORY_OPENABLE)
            putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
        }
        activity.runOnUiThread { startActivityForResult(invoke, intent, "audioSelected") }
    }

    @ActivityCallback
    private fun audioSelected(invoke: Invoke, result: ActivityResult) {
        if (result.resultCode != Activity.RESULT_OK) {
            invoke.resolve(JSObject().apply { put("paths", org.json.JSONArray()) }); return
        }
        val intent = result.data
        val uris = mutableListOf<Uri>()
        intent?.clipData?.let { clips -> for (i in 0 until clips.itemCount.coerceAtMost(100)) uris.add(clips.getItemAt(i).uri) }
        if (uris.isEmpty()) intent?.data?.let { uris.add(it) }
        io.execute {
            val paths = org.json.JSONArray()
            try {
                val directory = File(activity.filesDir, "imported").apply { mkdirs() }
                for (uri in uris.distinct()) {
                    val name = displayName(uri)
                    val extension = name.substringAfterLast('.', "").lowercase()
                    require(extension in listOf("mp3", "wav", "flac", "ogg", "m4a", "aac", "opus"))
                    val hash = MessageDigest.getInstance("SHA-256").digest(uri.toString().toByteArray()).joinToString("") { "%02x".format(it) }
                    val folder = File(directory, hash).apply { mkdirs() }
                    val safeName = name.replace(Regex("[\\\\/\\p{Cntrl}]"), "_").take(180).let { if (it.lowercase().endsWith(".$extension")) it else "audio.$extension" }
                    val target = File(folder, safeName)
                    val partial = File(folder, "audio.part")
                    try {
                        // An existing explicit import is reused and deduplicated by its path.
                        if (!target.exists()) {
                            activity.contentResolver.openInputStream(uri).use { input ->
                                requireNotNull(input)
                                partial.outputStream().use { output ->
                                    val buffer = ByteArray(65536); var total = 0L
                                    while (true) {
                                        val read = input.read(buffer); if (read < 0) break
                                        total += read; require(total <= 200L * 1024 * 1024)
                                        output.write(buffer, 0, read)
                                    }
                                    require(total > 0)
                                }
                            }
                            check(partial.renameTo(target))
                        }
                        paths.put(target.absolutePath)
                    } finally { partial.delete() }
                }
                invoke.resolve(JSObject().apply { put("paths", paths) })
            } catch (_: Exception) { invoke.reject("Could not import the audio. Choose supported files under 200 MB.") }
        }
    }

    private fun displayName(uri: Uri): String = activity.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use {
        if (it.moveToFirst()) it.getString(0) else "audio"
    } ?: "audio"

    @Command
    fun pickText(invoke: Invoke) {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            type = "*/*"; addCategory(Intent.CATEGORY_OPENABLE)
            putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("text/plain", "application/octet-stream", "application/x-subrip"))
        }
        activity.runOnUiThread { startActivityForResult(invoke, intent, "textSelected") }
    }

    @ActivityCallback
    private fun textSelected(invoke: Invoke, result: ActivityResult) {
        val uri = result.data?.data
        if (result.resultCode != Activity.RESULT_OK || uri == null) { invoke.resolve(); return }
        io.execute {
            try {
                val bytes = activity.contentResolver.openInputStream(uri).use { input ->
                    requireNotNull(input)
                    val out = java.io.ByteArrayOutputStream(); val buffer = ByteArray(8192)
                    while (true) {
                        val count = input.read(buffer); if (count < 0) break
                        require(out.size() + count <= 1048576); out.write(buffer, 0, count)
                    }
                    out.toByteArray()
                }
                val text = Charsets.UTF_8.newDecoder().decode(java.nio.ByteBuffer.wrap(bytes)).toString()
                invoke.resolve(JSObject().apply { put("text", text); put("fileName", displayName(uri)) })
            } catch (_: Exception) { invoke.reject("Choose a UTF-8 LRC or text file under 1 MB.") }
        }
    }

}
