package app.lumaire.player

import android.content.Intent
import android.app.PendingIntent
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import androidx.media3.common.Player
import androidx.media3.common.MediaItem
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.ForwardingPlayer
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService

/** Audio belongs to the service, never the WebView or Activity lifecycle. */
class PlaybackService : MediaSessionService() {
    companion object {
        var active: PlaybackService? = null; private set
        var listenedTrackId: String? = null
            private set
        var listenedMs: Long = 0
            private set
    }
    private var session: MediaSession? = null
    lateinit var queue: BackgroundQueue; private set
    private val clockHandler = Handler(Looper.getMainLooper())
    private var lastPosition = 0L
    private var lastTick = 0L
    private var wasPlaying = false
    private fun sample(position: Long? = null) {
        val player = session?.player ?: return
        val now = SystemClock.elapsedRealtime()
        val current = position ?: player.currentPosition
        val elapsed = now - lastTick
        val progress = current - lastPosition
        if (wasPlaying && elapsed in 1..5000 && progress > 0 && progress <= elapsed + 500) {
            listenedMs += minOf(elapsed, progress)
        }
        lastTick = now
        lastPosition = current
        wasPlaying = player.isPlaying
    }
    private val clockTick = object : Runnable {
        override fun run() {
            sample()
            queue.checkpoint(listenedMs, (session?.player?.currentPosition ?: 0) / 1000.0)
            if (BuildConfig.DEBUG) {
              try {
                val player = session?.player
                if (player != null) {
                    val state = org.json.JSONObject().put("id", player.currentMediaItem?.mediaId)
                        .put("time", player.currentPosition / 1000.0).put("playing", player.isPlaying)
                        .put("busy", queue.busy).put("currentId", queue.snapshot()?.optJSONObject("session")?.optString("currentId")).put("error", queue.error).put("refreshes", queue.refreshes)
                    java.io.File(filesDir, "background-queue-state.json").writeText(state.toString())
                }
              } catch (_: Exception) { /* A debug observation must never stop audio. */ }
            }
            WidgetUpdateHelper.onProgressTick(this@PlaybackService)
            if (session?.player?.isPlaying == true) clockHandler.postDelayed(this, 1000)
        }
    }

    override fun onCreate() {
        super.onCreate()
        active = this
        val factory = androidx.media3.datasource.DefaultDataSource.Factory(this, ScopedHttpHeaders.Factory())
        val player = ExoPlayer.Builder(this).setMediaSourceFactory(
            androidx.media3.exoplayer.source.DefaultMediaSourceFactory(this).setDataSourceFactory(factory)
        ).build().apply {
            setAudioAttributes(AudioAttributes.Builder()
                .setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build(), true)
            setHandleAudioBecomingNoisy(true)
            setWakeMode(C.WAKE_MODE_LOCAL)
        }
        queue = BackgroundQueue(this, player)
        player.addListener(object : Player.Listener {
            override fun onPlayWhenReadyChanged(ready: Boolean, reason: Int) {
                if (!ready && reason in listOf(Player.PLAY_WHEN_READY_CHANGE_REASON_AUDIO_FOCUS_LOSS, Player.PLAY_WHEN_READY_CHANGE_REASON_AUDIO_BECOMING_NOISY)) queue.interrupted()
            }
            override fun onPlaybackStateChanged(state: Int) {
                if (state == Player.STATE_ENDED && queue.managed) { checkpointProgress(); queue.advance() }
            }
            override fun onPlayerError(error: androidx.media3.common.PlaybackException) { checkpointProgress(); queue.recover() }
        })
        val controls = object : ForwardingPlayer(player) {
            override fun getAvailableCommands(): Player.Commands = super.getAvailableCommands().buildUpon().apply {
                if (queue.managed) { add(Player.COMMAND_SEEK_TO_NEXT); add(Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM); add(Player.COMMAND_SEEK_TO_PREVIOUS); add(Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM) }
            }.build()
            override fun seekToNext() { if (queue.managed) queue.advance(1, false) else super.seekToNext() }
            override fun seekToNextMediaItem() { if (queue.managed) queue.advance(1, false) else super.seekToNextMediaItem() }
            override fun seekToPrevious() { if (queue.managed) { if (currentPosition > 3000) seekTo(0) else queue.advance(-1, false) } else super.seekToPrevious() }
            override fun seekToPreviousMediaItem() { if (queue.managed) queue.advance(-1, false) else super.seekToPreviousMediaItem() }
            override fun pause() { if (queue.managed) queue.pause() else super.pause() }
            override fun play() { if (queue.managed) queue.play() else super.play() }
            override fun stop() {
                queue.invalidate()
                super.stop()
                clearMediaItems()
            }
        }
        session = MediaSession.Builder(this, controls).setSessionActivity(openAppIntent()).build()
        player.addListener(object : Player.Listener {
            override fun onIsPlayingChanged(isPlaying: Boolean) {
                sample()
                if (isPlaying) queue.playing()
                else if (!player.playWhenReady) checkpointProgress()
                clockHandler.removeCallbacks(clockTick)
                if (isPlaying) {
                    WidgetUpdateHelper.onProgressTick(this@PlaybackService)
                    clockHandler.postDelayed(clockTick, 1000)
                }
            }
            override fun onMediaItemTransition(item: MediaItem?, reason: Int) {
                listenedTrackId = item?.mediaId
                listenedMs = 0
                lastTick = SystemClock.elapsedRealtime()
                lastPosition = player.currentPosition
                wasPlaying = player.isPlaying
                queue.changed()
            }
            override fun onPositionDiscontinuity(old: Player.PositionInfo, new: Player.PositionInfo, reason: Int) {
                sample(old.positionMs)
                lastPosition = new.positionMs
                if (reason == Player.DISCONTINUITY_REASON_SEEK) checkpointProgress()
            }
        })
        WidgetUpdateHelper.attachPlayer(this, controls)
        val notificationProvider = androidx.media3.session.DefaultMediaNotificationProvider(this).apply {
            setSmallIcon(R.drawable.ic_notification)
        }
        setMediaNotificationProvider(notificationProvider)
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? {
        return if (controllerInfo.packageName == packageName || controllerInfo.isTrusted) session else null
    }

    private fun openAppIntent(): PendingIntent = PendingIntent.getActivity(
        this, 0, Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )

    override fun onTaskRemoved(rootIntent: Intent?) {
        // Dismissing the task is an explicit exit; Home and screen lock never call this.
        session?.player?.stop()
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
        super.onTaskRemoved(rootIntent)
    }

    override fun onDestroy() {
        queue.close(); active = null
        sample()
        clockHandler.removeCallbacks(clockTick)
        WidgetUpdateHelper.detachPlayer()
        session?.run { player.release(); release() }
        session = null
        super.onDestroy()
    }

    fun preparing(selection: org.json.JSONObject) {
        val manager = getSystemService(android.app.NotificationManager::class.java)
        manager.createNotificationChannel(android.app.NotificationChannel("default_channel_id", "Playback", android.app.NotificationManager.IMPORTANCE_LOW))
        val entry = selection.getJSONArray("queue").let { entries -> (0 until entries.length()).map { entries.getJSONObject(it) }.find { it.optString("id") == selection.optString("currentId") } }
        val title = entry?.let { selection.optJSONObject("queueTracks")?.optJSONObject(it.optString("trackId"))?.optString("title") } ?: "Lumaire"
        val notification = android.app.Notification.Builder(this, "default_channel_id").setSmallIcon(R.drawable.ic_notification)
            .setContentIntent(openAppIntent())
            .setContentTitle(title).setContentText("Preparing audio…").setOngoing(true).setCategory(android.app.Notification.CATEGORY_TRANSPORT).build()
        if (android.os.Build.VERSION.SDK_INT >= 29) startForeground(1001, notification, android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
        else startForeground(1001, notification)
    }

    fun finishedPreparing() {
        if (session?.player?.mediaItemCount == 0 && !queue.busy) stopForeground(STOP_FOREGROUND_REMOVE)
    }

    fun checkpointProgress() {
        sample()
        queue.checkpoint(listenedMs, (session?.player?.currentPosition ?: 0) / 1000.0, true)
    }
}
