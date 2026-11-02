package app.lumaire.player

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.os.PowerManager

/** Keeps the Rust download command's process alive independently of the Activity. */
class DownloadForegroundService : Service() {
    companion object {
        const val UPDATE = "app.lumaire.player.DOWNLOAD_UPDATE"
        const val STOP = "app.lumaire.player.DOWNLOAD_STOP"
        const val TITLE = "title"
        const val DONE = "done"
        const val TOTAL = "total"
        private const val NOTIFICATION_ID = 1002
        private const val CHANNEL_ID = "downloads_channel"
    }

    private var wakeLock: PowerManager.WakeLock? = null

    override fun onCreate() {
        super.onCreate()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            getSystemService(NotificationManager::class.java).createNotificationChannel(
                NotificationChannel(CHANNEL_ID, "Downloads", NotificationManager.IMPORTANCE_LOW).apply {
                    description = "Offline audio download progress"
                }
            )
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == STOP) {
            releaseWakeLock()
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf(startId)
            return START_NOT_STICKY
        }
        val title = intent?.getStringExtra(TITLE) ?: "Preparing downloads…"
        val done = intent?.getIntExtra(DONE, 0) ?: 0
        val total = intent?.getIntExtra(TOTAL, 0) ?: 0
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) Notification.Builder(this, CHANNEL_ID)
        else @Suppress("DEPRECATION") Notification.Builder(this)
        val notification = builder.setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(if (total > 0) "Downloading ($done/$total)" else "Downloading")
            .setContentText(title)
            .setProgress(total, done, total <= 0)
            .setOngoing(true)
            .setCategory(Notification.CATEGORY_PROGRESS)
            .build()
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(NOTIFICATION_ID, notification, android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else startForeground(NOTIFICATION_ID, notification)
        acquireWakeLock()
        return START_NOT_STICKY
    }

    private fun acquireWakeLock() {
        if (wakeLock?.isHeld == true) return
        val power = getSystemService(PowerManager::class.java)
        wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "lumaire:downloads").apply {
            setReferenceCounted(false)
            // Android 15 limits dataSync foreground services to six hours per 24-hour period.
            acquire(5 * 60 * 60 * 1000L)
        }
    }

    private fun releaseWakeLock() {
        wakeLock?.let { if (it.isHeld) it.release() }
        wakeLock = null
    }

    override fun onDestroy() {
        releaseWakeLock()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
