package app.lumaire.player

import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import org.json.JSONObject
import java.io.File
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/** Queue policy and transport run outside the Activity/renderer lifecycle. */
class BackgroundQueue(private val context: Context, private val player: ExoPlayer) {
    private class PreparationFailure(message: String) : Exception(message)
    val epoch: String = UUID.randomUUID().toString()
    private val main = Handler(Looper.getMainLooper())
    private val io = Executors.newSingleThreadExecutor()
    private val resolver = ResolverClient.shared(context)
    private val wake = context.getSystemService(PowerManager::class.java)
        .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "${context.packageName}:queue").apply { setReferenceCounted(false) }
    @Volatile private var generation = 0L
    @Volatile private var process: Process? = null
    private var queue: JSONObject? = null
    private var revision = 0L
    val version: Long get() = revision
    val managed: Boolean get() = queue != null
    val wantsPlayback: Boolean get() = playWhenReady
    val selectedTrackId: String? get() {
        val session = queue?.optJSONObject("session") ?: return null
        val entries = session.optJSONArray("queue") ?: return null
        return (0 until entries.length()).map { entries.getJSONObject(it) }
            .find { it.optString("id") == session.optString("currentId") }?.optString("trackId")
    }
    private var retried = false
    var busy = false; private set
    var error: String? = null; private set
    private var playWhenReady = true
    private var pendingDirection = 1
    private var pendingEnded = true
    private var loadingTrack: JSONObject? = null
    private var loadingPosition = 0.0
    private val failedEntries = linkedSetOf<String>()
    private val failedSources = linkedSetOf<String>()
    private var lastHistorySave = 0L
    var historyVersion = 0L; private set
    var refreshes = 0L; private set
    private var preservingListening = false

    fun start(input: JSONObject, autoplay: Boolean, position: Double) {
        invalidate()
        queue = JSONObject(input.toString())
        queue!!.getJSONObject("session").put("nativeQueueEpoch", epoch)
        queue!!.getJSONObject("session").put("position", position)
        playWhenReady = autoplay
        player.stop(); player.clearMediaItems()
        PlaybackService.active?.preparing(input.getJSONObject("session"))
        advance(0, false)
    }

    fun snapshot(): JSONObject? = queue?.let {
        val session = it.getJSONObject("session")
        val selection = JSONObject()
        listOf("queue", "queueTracks", "currentId", "position", "shuffleOrder").forEach { key -> selection.put(key, session.opt(key)) }
        JSONObject().put("epoch", epoch).put("revision", revision).put("session", selection)
    }

    fun accept(input: JSONObject, expectedRevision: Long): Boolean {
        if (expectedRevision != revision) return false
        val incoming = input.getJSONObject("session")
        val current = incoming.getJSONArray("queue").let { items ->
            (0 until items.length()).map { items.getJSONObject(it) }.find { it.optString("id") == incoming.optString("currentId") }
        } ?: return false
        if (current.optString("trackId") != (if (busy) selectedTrackId else player.currentMediaItem?.mediaId)) return false
        val previous = queue
        val before = previous?.getJSONObject("session")
        val changed = before != null && (before.getJSONArray("queue").toString() != incoming.getJSONArray("queue").toString()
            || before.optJSONArray("shuffleOrder").toString() != incoming.optJSONArray("shuffleOrder").toString()
            || listOf("shuffle", "repeat", "autoplay").any { before.getJSONObject("settings").opt(it) != incoming.getJSONObject("settings").opt(it) }
            || previous.getJSONArray("tracks").toString() != input.getJSONArray("tracks").toString())
        val resume = busy && changed
        val loading = loadingTrack
        if (resume) { generation++; cancelNative(); process?.destroy(); busy = false }
        val updated = JSONObject(input.toString())
        listOf("anchor", "recent", "turn").forEach { key -> previous?.opt(key)?.let { updated.put(key, it) } }
        if (previous?.optLong("listeningGeneration", -1) == input.optLong("listeningGeneration", -2)) {
            previous.optJSONObject("listening")?.let { updated.put("listening", it) }
        }
        queue = updated
        updated.getJSONObject("session").put("nativeQueueRevision", revision).put("nativeQueueEpoch", epoch)
        if (!busy) updated.getJSONObject("session").put("position", player.currentPosition / 1000.0).put("nativePositionAt", android.os.SystemClock.elapsedRealtime())
        updated.optJSONObject("listening")?.let { if (!it.has("entryId")) it.put("entryId", incoming.optString("currentId")) }
        if (resume) {
            if (loading != null) { busy = true; load(loading, generation, loadingPosition) }
            else advance(pendingDirection, pendingEnded)
        }
        return true
    }

    fun invalidate() {
        PlaybackService.active?.checkpointProgress()
        generation++; cancelNative(); process?.destroy(); process = null
        busy = false; error = null; queue = null; revision++; failedEntries.clear(); failedSources.clear(); refreshes = 0
        if (wake.isHeld) wake.release()
        io.execute { native("clear", JSONObject()) }
    }

    fun pause() { playWhenReady = false; player.pause() }
    fun play() { playWhenReady = true; player.play() }
    fun interrupted() { playWhenReady = false }

    fun advance(direction: Int = 1, ended: Boolean = true) {
        val state = queue ?: return
        if (direction != 0) failedSources.clear()
        if (busy) { generation++; cancelNative(); process?.destroy(); if (!ended) resolver.cancel() }
        if (direction != 0) playWhenReady = player.playWhenReady
        pendingDirection = direction; pendingEnded = ended; loadingTrack = null
        preservingListening = false
        val input = JSONObject(state.toString())
        input.put("failedEntries", org.json.JSONArray(failedEntries.toList()))
        input.put("failedSources", org.json.JSONArray(failedSources.toList()))
        if (direction != 0) input.getJSONObject("session").put("position", player.currentPosition.coerceAtLeast(0) / 1000.0)
        val token = ++generation
        cancelNative()
        busy = true; error = null; retried = false
        wake.acquire(125000)
        io.execute {
            try {
                val result = runPolicy(JSONObject().put("queue", input).put("direction", direction).put("ended", ended), token)
                main.post {
                    if (generation != token) return@post
                    if (result == null) { finish(if (state.getJSONObject("session").getJSONObject("settings").optBoolean("autoplay")) "Autoplay could not verify another matching song. Try Next again." else null); return@post }
                    val updated = result.getJSONObject("queue")
                    // Preserve preferences/lyrics updated while the next source was being prepared.
                    val session = JSONObject((queue ?: state).getJSONObject("session").toString())
                    val next = updated.getJSONObject("session")
                    listOf("queue", "queueTracks", "currentId", "position", "shuffleOrder").forEach { session.put(it, next.opt(it)) }
                    revision++; session.put("nativeQueueRevision", revision)
                    updated.put("session", session); queue = updated
                    io.execute { if (token == generation) native("commit", JSONObject().put("session", session), token) }
                    load(result.getJSONObject("track"), token, if (direction == 0) next.optDouble("position", 0.0) else 0.0)
                }
            } catch (failure: Exception) { main.post { if (generation == token) finish(if (failure is PreparationFailure) failure.message else "Could not prepare the next song. Check your connection and retry.") } }
        }
    }

    fun recover(): Boolean {
        val state = queue ?: return false
        if (busy) return true
        if (retried) {
            val id = player.currentMediaItem?.mediaId ?: ""
            val track = state.getJSONObject("session").optJSONObject("queueTracks")?.optJSONObject(id)
            if (track?.optString("metadataSourceId")?.let { it.startsWith("itunes:") || it.startsWith("saavn:") || it.startsWith("musicbrainz:") } == true && id.startsWith("youtube:") && failedSources.size < 3) {
                failedSources.add(id.removePrefix("youtube:"))
                state.getJSONObject("session").put("position", player.currentPosition.coerceAtLeast(0) / 1000.0)
                advance(0, false)
            } else unavailable("This recording still refused playback after refreshing its URL.")
            return true
        }
        retried = true; resolver.invalidate()
        refreshes++
        preservingListening = true
        val session = state.getJSONObject("session")
        val tracks = state.getJSONArray("tracks")
        val entries = session.getJSONArray("queue")
        val entry = (0 until entries.length()).map { entries.getJSONObject(it) }.find { it.optString("id") == session.optString("currentId") } ?: return false
        val id = entry.getString("trackId")
        val track = session.optJSONObject("queueTracks")?.optJSONObject(id)
            ?: (0 until tracks.length()).map { tracks.getJSONObject(it) }.find { it.optString("id") == id } ?: return false
        busy = true; playWhenReady = player.playWhenReady
        wake.acquire(125000)
        load(track, generation, player.currentPosition.coerceAtLeast(0) / 1000.0)
        return true
    }

    private fun load(track: JSONObject, token: Long, position: Double) {
        loadingTrack = track; loadingPosition = position
        val id = track.getString("id")
        fun attach(url: String, headers: JSONObject? = null) {
            if (token != generation) return
            val uri = Uri.parse(url)
            if (uri.scheme !in listOf("file", "https")) { finish("Invalid audio location."); return }
            ScopedHttpHeaders.register(uri, headers)
            val metadata = MediaMetadata.Builder().setTitle(track.optString("title")).setArtist(track.optString("artist"))
            track.optString("artworkUrl").takeIf { it.isNotBlank() && it != "null" }?.let { metadata.setArtworkUri(Uri.parse(it)) }
            player.setMediaItem(MediaItem.Builder().setMediaId(id).setUri(uri).setMediaMetadata(metadata.build()).build(), (position * 1000).toLong())
            player.prepare(); player.playWhenReady = playWhenReady
            WidgetUpdateHelper.updateTrackInfo(context, track.optString("title"), track.optString("artist"), track.optString("artworkUrl"))
            finish()
        }
        if (!track.optBoolean("offline") && id.startsWith("youtube:")) {
            resolver.request(JSONObject().put("operation", "resolve").put("videoId", id.removePrefix("youtube:"))) { value, failure ->
                if (token != generation) return@request
                if (failure != null || value == null) { unavailable("The audio source could not be refreshed."); return@request }
                attach(value.getString("url"), value.optJSONObject("headers"))
            }
        } else io.execute {
            val method = if (!track.optBoolean("offline") && id.startsWith("wikimedia-commons:")) "commons" else "media"
            val args = JSONObject().put("id", if (method == "commons") id.substringAfter(':') else id)
            val reply = native(method, args)
            main.post { if (token == generation) { if (reply.optBoolean("ok")) attach(reply.getString("value")) else unavailable("This audio is unavailable.") } }
        }
    }

    private fun finish(message: String? = null) {
        busy = false; error = message; loadingTrack = null
        if (wake.isHeld) wake.release()
        PlaybackService.active?.finishedPreparing()
    }

    fun playing() { failedEntries.clear() }

    fun changed() {
        val state = queue ?: return
        val listening = state.optJSONObject("listening") ?: JSONObject().also { state.put("listening", it) }
        val entry = state.getJSONObject("session").optString("currentId")
        if (!preservingListening || listening.optString("entryId") != entry) listening.put("record", JSONObject.NULL)
        preservingListening = false
        listening.put("entryId", entry).put("nativeCount", 0)
        lastHistorySave = 0
    }

    fun checkpoint(totalMs: Long, position: Double, force: Boolean = false) {
        val state = queue ?: return
        val session = state.getJSONObject("session")
        if (selectedTrackId != player.currentMediaItem?.mediaId) return
        val listening = state.optJSONObject("listening") ?: JSONObject().also { state.put("listening", it) }
        val previous = listening.optLong("nativeCount", 0)
        listening.put("nativeCount", totalMs)
        session.put("position", position).put("nativePositionAt", android.os.SystemClock.elapsedRealtime())
        fun savePosition() {
            val copy = JSONObject(session.toString())
            val token = generation
            // A forced checkpoint must reach SQLite before stop clears ownership or cancels this generation.
            if (force) native("commit", JSONObject().put("session", copy), token)
            else io.execute { if (token == generation) native("commit", JSONObject().put("session", copy), token) }
        }
        if (!session.getJSONObject("settings").optBoolean("historyEnabled", true)) {
            listening.put("record", JSONObject.NULL)
            if (force || System.currentTimeMillis() - lastHistorySave >= 5000) { lastHistorySave = System.currentTimeMillis(); savePosition() }
            return
        }
        val delta = (totalMs - previous).coerceAtLeast(0)
        if (delta == 0L) { if (force) savePosition(); return }
        val id = selectedTrackId ?: return
        val tracks = state.getJSONArray("tracks")
        val track = session.optJSONObject("queueTracks")?.optJSONObject(id)
            ?: (0 until tracks.length()).map { tracks.getJSONObject(it) }.find { it.optString("id") == id } ?: return
        val now = System.currentTimeMillis()
        val record = listening.optJSONObject("record") ?: JSONObject().apply {
            put("id", UUID.randomUUID().toString()); put("trackId", id)
            listOf("title", "artist", "album", "artworkUrl", "metadataSourceId").forEach { put(it, track.opt(it) ?: JSONObject.NULL) }
            put("providerId", track.optJSONObject("source")?.opt("providerId") ?: JSONObject.NULL)
            put("sourceId", track.optJSONObject("source")?.opt("sourceId") ?: JSONObject.NULL)
            put("startedAt", now - delta); put("listenedMs", 0); put("days", JSONObject())
        }.also { listening.put("record", it) }
        val days = record.getJSONObject("days")
        val date = java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.ROOT)
        var cursor = now - delta
        while (cursor < now) {
            val boundary = java.util.Calendar.getInstance().apply {
                timeInMillis = cursor; add(java.util.Calendar.DAY_OF_MONTH, 1)
                set(java.util.Calendar.HOUR_OF_DAY, 0); set(java.util.Calendar.MINUTE, 0); set(java.util.Calendar.SECOND, 0); set(java.util.Calendar.MILLISECOND, 0)
            }.timeInMillis
            val end = minOf(now, boundary)
            val key = date.format(java.util.Date(cursor))
            days.put(key, days.optLong(key) + end - cursor); cursor = end
        }
        record.put("listenedMs", record.optLong("listenedMs") + delta).put("updatedAt", now)
        if (record.optLong("listenedMs") >= 10000) {
            val records = state.getJSONArray("records")
            val index = (0 until records.length()).find { records.getJSONObject(it).optString("id") == record.optString("id") }
            if (index != null) records.put(index, JSONObject(record.toString())) else records.put(JSONObject(record.toString()))
        }
        if (force || now - lastHistorySave >= 5000) {
            lastHistorySave = now
            val args = JSONObject().put("generation", state.optLong("listeningGeneration", 0)).put("record", JSONObject(record.toString()))
            io.execute {
                val result = native("historyCheckpoint", args)
                if (result.optBoolean("ok") && result.optBoolean("value")) main.post { historyVersion++ }
            }
            savePosition()
        }
    }

    private fun unavailable(message: String) {
        val state = queue ?: return
        failedEntries.add(state.getJSONObject("session").optString("currentId"))
        finish(message)
        val session = state.getJSONObject("session")
        if (failedEntries.size < session.getJSONArray("queue").length() || (session.getJSONObject("settings").optBoolean("autoplay") && failedEntries.size < 8)) advance(1, false)
    }

    private fun cancelNative() {
        try { NativeQueueBridge.cancel(generation) } catch (_: LinkageError) { /* Activity has not initialized Rust yet. */ }
    }

    private fun native(method: String, args: JSONObject, owner: Long? = null): JSONObject = try {
        val request = JSONObject().put("method", method).put("args", args)
        if (owner != null) request.put("generation", owner)
        JSONObject(NativeQueueBridge.call(request.toString()))
    } catch (_: Exception) { JSONObject().put("ok", false).put("error", "Native library unavailable.") }
      catch (_: LinkageError) { JSONObject().put("ok", false).put("error", "Open Lumaire to initialize playback.") }

    private fun rpc(method: String, args: JSONObject, token: Long): JSONObject {
        check(token == generation)
        if (method == "uuid") return JSONObject().put("ok", true).put("value", UUID.randomUUID().toString())
        if (method !in listOf("search", "resolve")) return native(method, args, token)
        val answer = AtomicReference<JSONObject>()
        val ready = CountDownLatch(1)
        main.post {
            if (token != generation) { ready.countDown(); return@post }
            val request = if (method == "search") JSONObject().put("operation", "search").put("query", args.getString("query")).put("maxResults", args.optInt("maxResults", 15)).put("catalog", true)
                else JSONObject().put("operation", "resolve").put("videoId", args.getString("id"))
            resolver.request(request) { value, failure ->
                val reply = JSONObject().put("ok", failure == null && value != null)
                if (failure != null) reply.put("error", failure)
                else if (method == "search") reply.put("value", value?.optJSONArray("results"))
                else reply.put("value", value)
                answer.set(reply); ready.countDown()
            }
        }
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(95)
        while (!ready.await(100, TimeUnit.MILLISECONDS)) check(token == generation && System.nanoTime() < deadline)
        check(token == generation)
        return answer.get() ?: JSONObject().put("ok", false).put("error", "Lookup cancelled.")
    }

    private fun runPolicy(input: JSONObject, token: Long): JSONObject? {
        // Policy never reads these documents; keep large lyrics and sync replicas in the native session only.
        input.getJSONObject("queue").getJSONObject("session").apply {
            put("lyrics", JSONObject()); put("playlists", org.json.JSONArray()); remove("replica")
        }
        val script = File(context.cacheDir, "background-policy.mjs")
        val bytes = context.assets.open("background-policy.mjs").use { it.readBytes() }
        if (!script.exists() || !script.readBytes().contentEquals(bytes)) script.writeBytes(bytes)
        val child = ProcessBuilder(context.applicationInfo.nativeLibraryDir + "/libqjs.so", "--std", "--memory-limit", "98304", "-m", script.absolutePath).start()
        process = child
        val timeout = Runnable { if (token == generation) child.destroy() }
        main.postDelayed(timeout, 120000)
        Thread {
            try { child.errorStream.use { stream -> val buffer = ByteArray(4096); while (stream.read(buffer) >= 0) {} } }
            catch (_: java.io.IOException) { /* Process cancellation closes its diagnostic pipe. */ }
        }.apply { isDaemon = true; start() }
        try {
            val writer = child.outputStream.bufferedWriter()
            writer.write(input.toString()); writer.newLine(); writer.flush()
            val reader = child.inputStream.bufferedReader()
            repeat(512) {
                check(token == generation)
                val line = reader.readLine() ?: error("Queue worker disconnected")
                check(line.length <= 20 * 1024 * 1024)
                val message = JSONObject(line)
                when (message.getString("type")) {
                    "selection" -> main.post {
                        if (token == generation) {
                            val state = queue ?: return@post
                            state.getJSONObject("session").put("currentId", message.getString("entryId")).put("position", 0)
                            revision++; state.getJSONObject("session").put("nativeQueueRevision", revision)
                        }
                    }
                    "rpc" -> { writer.write(rpc(message.getString("method"), message.getJSONObject("args"), token).toString()); writer.newLine(); writer.flush() }
                    "result" -> return message.optJSONObject("value")
                    "error" -> throw PreparationFailure(message.optString("error", "This recording could not be prepared.").take(500))
                    else -> error("Queue worker failed")
                }
            }
            error("Queue worker request limit exceeded")
        } finally { main.removeCallbacks(timeout); child.destroy(); if (process === child) process = null }
    }

    fun close() { if (queue != null) invalidate(); io.shutdown() }
}
