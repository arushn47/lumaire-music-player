package app.lumaire.player

import android.content.*
import android.os.*
import org.json.JSONObject

/** Small IPC boundary. Neither signed URLs nor diagnostics are persisted. */
class ResolverClient(private val context: Context) {
    companion object {
        private var shared: ResolverClient? = null
        fun shared(context: Context): ResolverClient {
            check(Looper.myLooper() == Looper.getMainLooper())
            return shared ?: ResolverClient(context.applicationContext).also { shared = it }
        }
    }
    private val handler = Handler(Looper.getMainLooper())
    private var generation = 0
    private var connection: ServiceConnection? = null
    private var remote: Messenger? = null
    private var complete: ((JSONObject?, String?) -> Unit)? = null
    private var lastReleaseAt = 0L
    var lastDiagnostic = JSONObject(); private set
    private val timeout = Runnable { cancel("Online lookup timed out. Check your connection and try again.") }
    private val requests = ResolverRequests(
        { input, done -> start(JSONObject(input)) { result, error -> done(result?.toString(), error) } },
        { cancelTransport() },
        { SystemClock.elapsedRealtime() },
        { result -> ResolverRequests.sourceLifetime(JSONObject(result).getString("url"), System.currentTimeMillis()) },
    )

    fun invalidate() { requests.invalidate() }

    fun request(args: JSONObject, callback: (JSONObject?, String?) -> Unit) {
        check(Looper.myLooper() == Looper.getMainLooper())
        if (!BuildConfig.HAS_ANDROID_STREAMING) { callback(null, "Android streaming is disabled in this build."); return }
        val cacheable = args.optString("operation") == "resolve" && !args.optBoolean("download", false)
        val input = if (cacheable) JSONObject().put("operation", "resolve").put("videoId", args.getString("videoId")).toString() else args.toString()
        requests.request(input, cacheable) { raw, error ->
            val result = raw?.let { JSONObject(it) }
            lastDiagnostic = (result?.optJSONObject("diagnostic") ?: lastDiagnostic)
                .put("resolverExecutions", requests.executions).put("resolverCacheHits", requests.cacheHits)
            callback(result, error)
        }
    }

    private fun start(args: JSONObject, callback: (JSONObject?, String?) -> Unit) {
        val token = ++generation
        complete = callback
        handler.postDelayed({
            if (token != generation) return@postDelayed
            val replies = Messenger(Handler(Looper.getMainLooper()) { message ->
                if (token == generation && message.data.getInt("generation") == token) {
                    val result = try {
                        JSONObject(message.data.getString("result") ?: "{}").also { value ->
                            if (args.optString("operation") == "resolve" && !value.has("error")) {
                                require(value.optString("videoCodec") == "none" && value.optString("codec").let { it.isNotBlank() && it != "none" })
                                val url = value.getString("url")
                                val uri = java.net.URI(url)
                                require(url.length <= 8192 && uri.scheme == "https" && uri.host?.lowercase()?.endsWith(".googlevideo.com") == true && uri.port in listOf(-1, 443) && uri.userInfo == null)
                                val headers = value.optJSONObject("headers") ?: JSONObject()
                                StreamHeaderPolicy.checked(url, headers.keys().asSequence().associateWith { headers.getString(it) })
                            }
                        }
                    } catch (_: Exception) { JSONObject().put("error", "Invalid resolver response.") }
                    lastDiagnostic = result.optJSONObject("diagnostic") ?: JSONObject()
                    val done = complete; complete = null; release(false)
                    done?.invoke(if (result.has("error")) null else result, result.optString("error").takeIf { it.isNotEmpty() })
                }
                true
            })
            val link = object : ServiceConnection {
                override fun onServiceConnected(name: ComponentName, binder: IBinder) {
                    if (token != generation) return
                    try {
                        remote = Messenger(binder)
                        remote?.send(Message.obtain(null, 1).apply {
                            data = Bundle().apply { putString("request", args.toString()); putInt("generation", token) }
                            replyTo = replies
                        })
                    } catch (_: Exception) { cancel("Android resolver disconnected. Try again.") }
                }
                override fun onServiceDisconnected(name: ComponentName) {
                    if (token == generation && complete != null) cancel("Android resolver disconnected. Try again.")
                }
                override fun onNullBinding(name: ComponentName) { if (token == generation) cancel("Android resolver is unavailable.") }
            }
            connection = link
            if (!context.bindService(Intent().setClassName(context, "app.lumaire.player.ResolverService"), link, Context.BIND_AUTO_CREATE))
                cancel("Android resolver could not start.")
        }, maxOf(0L, 200L - (SystemClock.uptimeMillis() - lastReleaseAt)))
        handler.postDelayed(timeout, 90000)
    }
    private fun release(kill: Boolean) {
        handler.removeCallbacks(timeout)
        if (kill) try { remote?.send(Message.obtain(null, 2)) } catch (_: Exception) { }
        remote = null
        connection?.let { try { context.unbindService(it) } catch (_: Exception) { } }
        if (connection != null) lastReleaseAt = SystemClock.uptimeMillis()
        connection = null
    }
    private fun cancelTransport() {
        generation++
        val running = complete != null
        complete = null
        release(running)
    }
    fun cancel(reason: String = "Online lookup cancelled.") { requests.cancel(reason) }
}
