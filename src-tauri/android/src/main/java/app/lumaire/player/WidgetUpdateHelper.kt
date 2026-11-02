package app.lumaire.player

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.BitmapShader
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Shader
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.TypedValue
import android.view.View
import android.widget.RemoteViews
import androidx.core.content.ContextCompat
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import java.io.File
import java.io.InputStream
import java.lang.ref.WeakReference
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.Executors

data class NativeLyricLine(val timeMs: Long, val text: String)

data class ExtractedColors(
    val bgGradientStart: Int,
    val bgGradientEnd: Int,
    val strokeColor: Int,
    val primaryTextColor: Int,
    val secondaryTextColor: Int,
    val accentColor: Int
)

/**
 * Thread-safe mediator coordinating native Android home-screen widgets,
 * adaptive sizing, dynamic color extraction from album artwork,
 * battery-efficient progress bar sync, and live lyrics.
 */
object WidgetUpdateHelper {
    const val ACTION_PLAY_PAUSE = "app.lumaire.player.ACTION_WIDGET_PLAY_PAUSE"
    const val ACTION_PREV = "app.lumaire.player.ACTION_WIDGET_PREV"
    const val ACTION_NEXT = "app.lumaire.player.ACTION_WIDGET_NEXT"

    private const val PREFS_NAME = "lumaire_widget_prefs"
    private const val KEY_THEME_MODE = "theme_mode"
    private const val KEY_ACCENT_COLOR = "accent_color"

    @Volatile var title: String = "Not Playing"
    @Volatile var artist: String = "Lumaire"
    @Volatile var artworkUri: String? = null
    @Volatile var artworkBitmap: Bitmap? = null
    @Volatile var isPlaying: Boolean = false
    @Volatile var currentPositionMs: Long = 0L
    @Volatile var durationMs: Long = 0L
    @Volatile var pendingAction: String? = null

    @Volatile var themeMode: String = "dark"
    @Volatile var accentColor: String = "#A78BFA"
    private var prefsLoaded = false

    @Volatile var activeTrackId: String? = null
    val lyricLines = CopyOnWriteArrayList<NativeLyricLine>()
    @Volatile var prevLyricText: String = ""
    @Volatile var currentLyricText: String = "Not playing"
    @Volatile var nextLyricText: String = "Play music in Lumaire"
    @Volatile var next2LyricText: String = ""

    private var cachedExtractedColors: ExtractedColors? = null
    private var cachedArtSource: Bitmap? = null

    private var playerRef: WeakReference<Player>? = null
    private var contextRef: WeakReference<Context>? = null
    private val mainHandler by lazy { Handler(Looper.getMainLooper()) }
    private val ioExecutor by lazy { Executors.newSingleThreadExecutor() }

    private val lyricTickRunnable = Runnable {
        val ctx = contextRef?.get() ?: return@Runnable
        evaluateLyrics(ctx)
    }

    private val playerListener = object : Player.Listener {
        override fun onIsPlayingChanged(playing: Boolean) {
            isPlaying = playing
            val ctx = contextRef?.get() ?: return
            updateNowPlayingWidgets(ctx)
            evaluateLyrics(ctx)
        }

        override fun onPlaybackStateChanged(state: Int) {
            val player = playerRef?.get() ?: return
            currentPositionMs = player.currentPosition.coerceAtLeast(0L)
            durationMs = player.duration.coerceAtLeast(0L)
            val ctx = contextRef?.get() ?: return
            updateNowPlayingWidgets(ctx)
            evaluateLyrics(ctx)
        }

        override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
            val metadata = mediaItem?.mediaMetadata
            val newTitle = metadata?.title?.toString()
            val newArtist = metadata?.artist?.toString()
            val newArt = metadata?.artworkUri?.toString()
            val mediaId = mediaItem?.mediaId
            if (mediaId != null && mediaId != activeTrackId) {
                activeTrackId = mediaId
                lyricLines.clear()
                prevLyricText = ""
                currentLyricText = "•••"
                nextLyricText = ""
                next2LyricText = ""
            }
            val ctx = contextRef?.get() ?: return
            updateTrackInfo(ctx, newTitle, newArtist, newArt)
        }

        override fun onPositionDiscontinuity(
            oldPosition: Player.PositionInfo,
            newPosition: Player.PositionInfo,
            reason: Int
        ) {
            currentPositionMs = newPosition.positionMs
            val ctx = contextRef?.get() ?: return
            evaluateLyrics(ctx)
        }
    }

    private fun ensurePrefsLoaded(context: Context) {
        if (prefsLoaded) return
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        themeMode = prefs.getString(KEY_THEME_MODE, "dark") ?: "dark"
        accentColor = prefs.getString(KEY_ACCENT_COLOR, "#A78BFA") ?: "#A78BFA"
        prefsLoaded = true
    }

    fun setTheme(context: Context, mode: String, accent: String) {
        themeMode = mode
        accentColor = accent
        cachedExtractedColors = null
        prefsLoaded = true
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().putString(KEY_THEME_MODE, mode).putString(KEY_ACCENT_COLOR, accent).apply()
        updateNowPlayingWidgets(context)
        updateLyricsWidgets(context)
    }

    fun attachPlayer(context: Context, player: Player) {
        contextRef = WeakReference(context.applicationContext)
        playerRef = WeakReference(player)
        ensurePrefsLoaded(context)
        player.addListener(playerListener)
        isPlaying = player.isPlaying
        currentPositionMs = player.currentPosition.coerceAtLeast(0L)
        durationMs = player.duration.coerceAtLeast(0L)
        updateNowPlayingWidgets(context)
        evaluateLyrics(context)
    }

    fun detachPlayer() {
        mainHandler.removeCallbacks(lyricTickRunnable)
        playerRef?.get()?.removeListener(playerListener)
        playerRef = null
    }

    fun togglePlayPause(context: Context) {
        val player = playerRef?.get()
        if (player != null) {
            if (player.isPlaying) {
                player.pause()
                isPlaying = false
            } else {
                if (player.playbackState == Player.STATE_IDLE) {
                    player.prepare()
                }
                player.play()
                isPlaying = true
            }
        } else {
            isPlaying = !isPlaying
        }
        updateNowPlayingWidgets(context)
        evaluateLyrics(context)
    }

    fun skipNext(context: Context) {
        PlaybackService.active?.queue?.takeIf { it.managed }?.let { it.advance(1, false); return }
        val player = playerRef?.get()
        if (player != null && player.hasNextMediaItem()) {
            player.seekToNextMediaItem()
        } else {
            pendingAction = "next"
        }
        updateNowPlayingWidgets(context)
    }

    fun skipPrevious(context: Context) {
        PlaybackService.active?.queue?.takeIf { it.managed }?.let {
            if ((playerRef?.get()?.currentPosition ?: 0) > 3000) playerRef?.get()?.seekTo(0) else it.advance(-1, false)
            return
        }
        val player = playerRef?.get()
        if (player != null && player.currentPosition > 3000L) {
            player.seekTo(0L)
        } else if (player != null && player.hasPreviousMediaItem()) {
            player.seekToPreviousMediaItem()
        } else {
            pendingAction = "prev"
        }
        updateNowPlayingWidgets(context)
    }

    fun consumePendingAction(): String? {
        val action = pendingAction
        pendingAction = null
        return action
    }

    fun updateTrackInfo(context: Context, newTitle: String?, newArtist: String?, newArtworkUri: String?) {
        title = if (newTitle.isNullOrBlank()) "Not Playing" else newTitle
        artist = if (newArtist.isNullOrBlank()) "Lumaire" else newArtist
        val oldArt = artworkUri
        artworkUri = newArtworkUri

        if (newArtworkUri != oldArt) {
            artworkBitmap = null
            cachedExtractedColors = null
            if (!newArtworkUri.isNullOrBlank()) {
                loadArtworkAsync(context, newArtworkUri)
            }
        }
        updateNowPlayingWidgets(context)
        evaluateLyrics(context)
    }

    fun setLyrics(context: Context, trackId: String, lines: List<NativeLyricLine>) {
        activeTrackId = trackId
        lyricLines.clear()
        lyricLines.addAll(lines.sortedBy { it.timeMs })
        evaluateLyrics(context)
    }

    fun upcomingLyrics(lines: List<NativeLyricLine>, from: Int): String =
        lines.asSequence().drop(from.coerceAtLeast(0)).take(24).joinToString("\n") { it.text }

    private fun evaluateLyrics(context: Context) {
        val player = playerRef?.get()
        val pos = player?.currentPosition ?: currentPositionMs

        if (lyricLines.isEmpty()) {
            mainHandler.removeCallbacks(lyricTickRunnable)
            prevLyricText = ""
            next2LyricText = ""
            if (title == "Not Playing" || (!isPlaying && pos == 0L)) {
                currentLyricText = "Not playing"
                nextLyricText = "Play music in Lumaire"
            } else {
                currentLyricText = "No lyrics available"
                nextLyricText = ""
            }
            updateLyricsWidgets(context)
            return
        }

        var nextTargetMs: Long? = null
        if (pos < lyricLines[0].timeMs) {
            prevLyricText = ""
            currentLyricText = "•••"
            nextLyricText = lyricLines[0].text
            next2LyricText = upcomingLyrics(lyricLines, 1)
            nextTargetMs = lyricLines[0].timeMs
        } else {
            var activeIdx = 0
            for (i in lyricLines.indices) {
                if (lyricLines[i].timeMs <= pos) {
                    activeIdx = i
                } else {
                    break
                }
            }
            prevLyricText = if (activeIdx > 0) lyricLines[activeIdx - 1].text else ""
            currentLyricText = lyricLines[activeIdx].text
            if (activeIdx + 1 < lyricLines.size) {
                nextLyricText = lyricLines[activeIdx + 1].text
                nextTargetMs = lyricLines[activeIdx + 1].timeMs
            } else {
                nextLyricText = ""
                nextTargetMs = null
            }
            next2LyricText = upcomingLyrics(lyricLines, activeIdx + 2)
        }

        updateLyricsWidgets(context)

        mainHandler.removeCallbacks(lyricTickRunnable)
        if (isPlaying && nextTargetMs != null) {
            val delay = (nextTargetMs - pos).coerceIn(50L, 120000L)
            mainHandler.postDelayed(lyricTickRunnable, delay)
        }
    }

    private fun loadArtworkAsync(context: Context, uriString: String) {
        ioExecutor.execute {
            try {
                val bitmap = if (uriString.startsWith("https://", ignoreCase = true) || uriString.startsWith("http://", ignoreCase = true)) {
                    val url = URL(uriString)
                    val conn = (url.openConnection() as HttpURLConnection).apply {
                        connectTimeout = 4000
                        readTimeout = 4000
                        instanceFollowRedirects = true
                    }
                    conn.inputStream.use { input -> decodeSampledBitmap(input, 256, 256) }
                } else {
                    val path = if (uriString.startsWith("file://", ignoreCase = true)) {
                        Uri.parse(uriString).path ?: uriString.removePrefix("file://")
                    } else uriString
                    val file = File(path)
                    if (file.exists()) {
                        file.inputStream().use { input -> decodeSampledBitmap(input, 256, 256) }
                    } else null
                }

                if (bitmap != null) {
                    val rounded = getRoundedCornerBitmap(bitmap, 12f, context)
                    artworkBitmap = rounded
                    cachedExtractedColors = null
                    mainHandler.post {
                        updateNowPlayingWidgets(context)
                        updateLyricsWidgets(context)
                    }
                }
            } catch (_: Exception) {
                artworkBitmap = null
            }
        }
    }

    private fun decodeSampledBitmap(inputStream: InputStream, reqWidth: Int, reqHeight: Int): Bitmap? {
        val bytes = inputStream.readBytes()
        if (bytes.isEmpty() || bytes.size > 5 * 1024 * 1024) return null
        val options = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)

        var inSampleSize = 1
        if (options.outHeight > reqHeight || options.outWidth > reqWidth) {
            val halfHeight = options.outHeight / 2
            val halfWidth = options.outWidth / 2
            while (halfHeight / inSampleSize >= reqHeight && halfWidth / inSampleSize >= reqWidth) {
                inSampleSize *= 2
            }
        }

        val decodeOptions = BitmapFactory.Options().apply {
            this.inSampleSize = inSampleSize
            inPreferredConfig = Bitmap.Config.ARGB_8888
        }
        return BitmapFactory.decodeByteArray(bytes, 0, bytes.size, decodeOptions)
    }

    private fun getRoundedCornerBitmap(bitmap: Bitmap, cornerRadiusDp: Float, context: Context): Bitmap {
        val density = context.resources.displayMetrics.density
        val radiusPx = cornerRadiusDp * density
        val output = Bitmap.createBitmap(bitmap.width, bitmap.height, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(output)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG)
        val shader = BitmapShader(bitmap, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP)
        paint.shader = shader
        val rect = RectF(0f, 0f, bitmap.width.toFloat(), bitmap.height.toFloat())
        canvas.drawRoundRect(rect, radiusPx, radiusPx, paint)
        return output
    }

    fun colorRgb(r: Int, g: Int, b: Int): Int =
        (0xFF shl 24) or ((r.coerceIn(0, 255) and 0xFF) shl 16) or ((g.coerceIn(0, 255) and 0xFF) shl 8) or (b.coerceIn(0, 255) and 0xFF)

    fun colorRed(color: Int): Int = (color shr 16) and 0xFF
    fun colorGreen(color: Int): Int = (color shr 8) and 0xFF
    fun colorBlue(color: Int): Int = color and 0xFF

    fun parseHexColor(hex: String?, defaultColor: Int): Int {
        if (hex.isNullOrBlank()) return defaultColor
        val clean = hex.trim().removePrefix("#")
        return try {
            when (clean.length) {
                6 -> {
                    val r = clean.substring(0, 2).toInt(16)
                    val g = clean.substring(2, 4).toInt(16)
                    val b = clean.substring(4, 6).toInt(16)
                    colorRgb(r, g, b)
                }
                8 -> {
                    val a = clean.substring(0, 2).toInt(16)
                    val r = clean.substring(2, 4).toInt(16)
                    val g = clean.substring(4, 6).toInt(16)
                    val b = clean.substring(6, 8).toInt(16)
                    ((a and 0xFF) shl 24) or ((r and 0xFF) shl 16) or ((g and 0xFF) shl 8) or (b and 0xFF)
                }
                else -> defaultColor
            }
        } catch (_: Exception) {
            defaultColor
        }
    }

    fun blendColors(foreground: Int, background: Int, bgWeight: Float): Int {
        val fgWeight = (1f - bgWeight).coerceIn(0f, 1f)
        val r = (colorRed(foreground) * fgWeight + colorRed(background) * bgWeight).toInt().coerceIn(0, 255)
        val g = (colorGreen(foreground) * fgWeight + colorGreen(background) * bgWeight).toInt().coerceIn(0, 255)
        val b = (colorBlue(foreground) * fgWeight + colorBlue(background) * bgWeight).toInt().coerceIn(0, 255)
        return colorRgb(r, g, b)
    }

    fun artworkColors(sample: Int?, isLight: Boolean): ExtractedColors {
        val ink = colorRgb(22, 25, 29)
        val paper = colorRgb(248, 247, 244)
        val hue = sample ?: colorRgb(105, 113, 122)
        return if (isLight) ExtractedColors(
            blendColors(hue, paper, 0.83f), blendColors(hue, paper, 0.94f),
            blendColors(hue, paper, 0.65f), ink, colorRgb(64, 69, 75),
            blendColors(hue, ink, 0.70f)
        ) else ExtractedColors(
            blendColors(hue, ink, 0.78f), blendColors(hue, ink, 0.88f),
            blendColors(hue, paper, 0.44f), paper, colorRgb(231, 233, 235),
            blendColors(hue, paper, 0.86f)
        )
    }

    fun extractColors(bitmap: Bitmap?, isLight: Boolean): ExtractedColors {
        if (bitmap == null) return artworkColors(null, isLight)
        var sumR = 0L
        var sumG = 0L
        var sumB = 0L
        var weights = 0L
        for (x in 0 until bitmap.width step (bitmap.width / 16).coerceAtLeast(1)) {
            for (y in 0 until bitmap.height step (bitmap.height / 16).coerceAtLeast(1)) {
                val pixel = bitmap.getPixel(x, y)
                if (pixel ushr 24 < 128) continue
                val r = colorRed(pixel)
                val g = colorGreen(pixel)
                val b = colorBlue(pixel)
                // Give cover colors more influence than white lettering and black margins.
                val weight = (maxOf(r, g, b) - minOf(r, g, b) + 16).toLong()
                sumR += r * weight
                sumG += g * weight
                sumB += b * weight
                weights += weight
            }
        }
        val sample = if (weights == 0L) null else colorRgb(
            (sumR / weights).toInt(), (sumG / weights).toInt(), (sumB / weights).toInt()
        )
        return artworkColors(sample, isLight)
    }

    private fun getOrComputeColors(isLight: Boolean): ExtractedColors {
        val art = artworkBitmap
        if (cachedExtractedColors != null && cachedArtSource === art) {
            return cachedExtractedColors!!
        }
        val computed = extractColors(art, isLight)
        cachedExtractedColors = computed
        cachedArtSource = art
        return computed
    }

    private fun createWidgetBackgroundBitmap(
        widthDp: Int,
        heightDp: Int,
        density: Float,
        colors: ExtractedColors
    ): Bitmap {
        val width = widthDp.coerceAtLeast(100)
        val height = heightDp.coerceAtLeast(50)
        val scale = minOf(density, 480f / width, 360f / height)
        val renderWidth = (width * scale).toInt().coerceAtLeast(1)
        val renderHeight = (height * scale).toInt().coerceAtLeast(1)
        val bitmap = Bitmap.createBitmap(renderWidth, renderHeight, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        val rect = RectF(0f, 0f, renderWidth.toFloat(), renderHeight.toFloat())
        val radius = 16f * scale
        val paint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
        paint.shader = LinearGradient(0f, 0f, rect.right, rect.bottom,
            colors.bgGradientStart, colors.bgGradientEnd, Shader.TileMode.CLAMP)
        canvas.drawRoundRect(rect, radius, radius, paint)
        canvas.save()
        canvas.clipPath(Path().apply { addRoundRect(rect, radius, radius, Path.Direction.CW) })
        paint.alpha = 255
        paint.shader = LinearGradient(0f, 0f, 0f, rect.bottom,
            0x14FFFFFF, Color.TRANSPARENT, Shader.TileMode.CLAMP)
        canvas.drawRect(rect, paint)
        canvas.restore()
        paint.shader = null
        paint.color = 0x32FFFFFF
        paint.style = Paint.Style.STROKE
        paint.strokeWidth = scale
        val inset = RectF(rect).apply { inset(scale / 2, scale / 2) }
        canvas.drawRoundRect(inset, radius, radius, paint)

        return bitmap
    }

    /**
     * Renders prominent rounded-square play/pause button with optical center adjustment.
     */
    fun getPlayPauseBitmap(context: Context, isPlaying: Boolean, accentColorInt: Int): Bitmap {
        val density = context.resources.displayMetrics.density
        val sizePx = (46 * density).toInt()
        val bitmap = Bitmap.createBitmap(sizePx, sizePx, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)

        val bgPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = accentColorInt
            style = Paint.Style.FILL
        }
        val radius = sizePx / 2f
        canvas.drawRoundRect(RectF(0f, 0f, sizePx.toFloat(), sizePx.toFloat()), 16f * density, 16f * density, bgPaint)

        val r = Color.red(accentColorInt)
        val g = Color.green(accentColorInt)
        val b = Color.blue(accentColorInt)
        val darkness = 1 - (0.299 * r + 0.587 * g + 0.114 * b) / 255
        val iconColor = if (darkness >= 0.45) Color.WHITE else Color.parseColor("#18181B")

        val iconDrawable = ContextCompat.getDrawable(
            context,
            if (isPlaying) R.drawable.ic_widget_pause else R.drawable.ic_widget_play
        )?.mutate()

        if (iconDrawable != null) {
            iconDrawable.setTint(iconColor)
            val iconSize = (22 * density).toInt()
            val baseOffset = (sizePx - iconSize) / 2
            val xShift = if (!isPlaying) (1.2f * density).toInt() else 0
            iconDrawable.setBounds(
                baseOffset + xShift,
                baseOffset,
                baseOffset + xShift + iconSize,
                baseOffset + iconSize
            )
            iconDrawable.draw(canvas)
        }

        return bitmap
    }

    fun formatTime(ms: Long): String {
        val totalSeconds = (ms / 1000).coerceAtLeast(0L)
        val minutes = totalSeconds / 60
        val seconds = totalSeconds % 60
        return if (minutes >= 60) {
            val hours = minutes / 60
            val remMin = minutes % 60
            String.format("%d:%02d:%02d", hours, remMin, seconds)
        } else {
            String.format("%d:%02d", minutes, seconds)
        }
    }

    /**
     * Battery-efficient progress tick called from PlaybackService clock handler.
     * Uses partiallyUpdateAppWidget to avoid re-inflating views or recreating bitmaps.
     */
    fun onProgressTick(context: Context) {
        val player = playerRef?.get()
        if (player != null) {
            currentPositionMs = player.currentPosition.coerceAtLeast(0L)
            durationMs = player.duration.coerceAtLeast(0L)
        }
        updateProgressOnly(context)
    }

    private fun updateProgressOnly(context: Context) {
        val appWidgetManager = AppWidgetManager.getInstance(context) ?: return
        val componentName = ComponentName(context, NowPlayingWidgetProvider::class.java)
        val ids = appWidgetManager.getAppWidgetIds(componentName)
        if (ids.isEmpty()) return

        val progressInt = if (durationMs > 0) {
            ((currentPositionMs * 1000) / durationMs).toInt().coerceIn(0, 1000)
        } else 0
        val elapsedStr = formatTime(currentPositionMs)
        val totalStr = formatTime(durationMs)

        for (appWidgetId in ids) {
            val options = appWidgetManager.getAppWidgetOptions(appWidgetId)
            val minHeight = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0)
            if (minHeight > 85 || minHeight == 0) {
                val partialViews = RemoteViews(context.packageName, R.layout.widget_now_playing)
                partialViews.setProgressBar(R.id.widget_progress_expanded, 1000, progressInt, false)
                partialViews.setTextViewText(R.id.widget_time_elapsed_expanded, elapsedStr)
                partialViews.setTextViewText(R.id.widget_time_total_expanded, totalStr)

                partialViews.setProgressBar(R.id.widget_progress_card, 1000, progressInt, false)
                partialViews.setTextViewText(R.id.widget_time_elapsed_card, elapsedStr)
                partialViews.setTextViewText(R.id.widget_time_total_card, totalStr)

                appWidgetManager.partiallyUpdateAppWidget(appWidgetId, partialViews)
            }
        }
    }

    fun updateNowPlayingWidgets(context: Context) {
        ensurePrefsLoaded(context)
        val appWidgetManager = AppWidgetManager.getInstance(context) ?: return
        val componentName = ComponentName(context, NowPlayingWidgetProvider::class.java)
        val ids = appWidgetManager.getAppWidgetIds(componentName)
        if (ids.isEmpty()) return

        val isLight = themeMode.equals("light", ignoreCase = true)
        val colors = getOrComputeColors(isLight)
        val buttonBgRes = android.R.color.transparent
        val buttonIconTint = colors.primaryTextColor
        val playPauseBitmap = getPlayPauseBitmap(context, isPlaying, colors.accentColor)

        val progressInt = if (durationMs > 0) {
            ((currentPositionMs * 1000) / durationMs).toInt().coerceIn(0, 1000)
        } else 0
        val elapsedStr = formatTime(currentPositionMs)
        val totalStr = formatTime(durationMs)
        val density = context.resources.displayMetrics.density

        for (appWidgetId in ids) {
            val views = RemoteViews(context.packageName, R.layout.widget_now_playing)
            val options = appWidgetManager.getAppWidgetOptions(appWidgetId)
            val minHeight = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0)
            val minWidth = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0)

            // Dynamic rounded-rect gradient background:
            val bgBitmap = createWidgetBackgroundBitmap(
                if (minWidth > 0) minWidth else 260,
                if (minHeight in 1..85) 72 else if (minHeight > 0) minHeight else 90,
                density,
                colors
            )
            val compact = minHeight in 1..85
            views.setViewVisibility(R.id.widget_bg_image, if (compact) View.GONE else View.VISIBLE)
            views.setImageViewBitmap(if (compact) R.id.widget_compact_bg_image else R.id.widget_bg_image, bgBitmap)

            // Determine layout mode:
            // 1. Compact: height <= 85dp (1-row horizontal bar)
            // 2. Expanded: height 86..145dp and width >= 220dp (standard horizontal medium)
            // 3. Card: height > 145dp or narrow (2x2, 3x3, 4x3)
            val isCompact = minHeight in 1..85
            val isExpanded = (minHeight in 86..145 && minWidth >= 220) || (minHeight == 0 && minWidth >= 220)
            val isCard = !isCompact && !isExpanded

            if (isCompact) {
                views.setViewVisibility(R.id.widget_compact_layout, View.VISIBLE)
                views.setViewVisibility(R.id.widget_expanded_layout, View.GONE)
                views.setViewVisibility(R.id.widget_card_layout, View.GONE)

                views.setTextViewText(R.id.widget_title, title)
                views.setTextColor(R.id.widget_title, colors.primaryTextColor)
                views.setTextViewText(R.id.widget_artist, artist)
                views.setTextColor(R.id.widget_artist, colors.secondaryTextColor)

                if (artworkBitmap != null) {
                    views.setImageViewBitmap(R.id.widget_art, artworkBitmap)
                } else {
                    views.setImageViewResource(R.id.widget_art, R.drawable.ic_widget_art_fallback)
                }

                views.setImageViewBitmap(R.id.widget_btn_play_pause, playPauseBitmap)
                views.setInt(R.id.widget_btn_prev, "setBackgroundResource", buttonBgRes)
                views.setInt(R.id.widget_btn_prev, "setColorFilter", buttonIconTint)
                views.setInt(R.id.widget_btn_next, "setBackgroundResource", buttonBgRes)
                views.setInt(R.id.widget_btn_next, "setColorFilter", buttonIconTint)

                if (minWidth in 1..210) {
                    views.setViewVisibility(R.id.widget_btn_prev, View.GONE)
                    views.setViewVisibility(R.id.widget_btn_next, View.GONE)
                } else {
                    views.setViewVisibility(R.id.widget_btn_prev, View.VISIBLE)
                    views.setViewVisibility(R.id.widget_btn_next, View.VISIBLE)
                }
            } else if (isExpanded) {
                views.setViewVisibility(R.id.widget_compact_layout, View.GONE)
                views.setViewVisibility(R.id.widget_expanded_layout, View.VISIBLE)
                views.setViewVisibility(R.id.widget_card_layout, View.GONE)

                views.setTextViewText(R.id.widget_title_expanded, title)
                views.setTextColor(R.id.widget_title_expanded, colors.primaryTextColor)
                views.setTextViewText(R.id.widget_artist_expanded, artist)
                views.setTextColor(R.id.widget_artist_expanded, colors.secondaryTextColor)

                if (artworkBitmap != null) {
                    views.setImageViewBitmap(R.id.widget_art_expanded, artworkBitmap)
                } else {
                    views.setImageViewResource(R.id.widget_art_expanded, R.drawable.ic_widget_art_fallback)
                }

                views.setImageViewBitmap(R.id.widget_btn_play_pause_expanded, playPauseBitmap)
                views.setInt(R.id.widget_btn_prev_expanded, "setBackgroundResource", buttonBgRes)
                views.setInt(R.id.widget_btn_prev_expanded, "setColorFilter", buttonIconTint)
                views.setInt(R.id.widget_btn_next_expanded, "setBackgroundResource", buttonBgRes)
                views.setInt(R.id.widget_btn_next_expanded, "setColorFilter", buttonIconTint)

                views.setProgressBar(R.id.widget_progress_expanded, 1000, progressInt, false)
                views.setTextViewText(R.id.widget_time_elapsed_expanded, elapsedStr)
                views.setTextViewText(R.id.widget_time_total_expanded, totalStr)
                views.setTextColor(R.id.widget_time_elapsed_expanded, colors.secondaryTextColor)
                views.setTextColor(R.id.widget_time_total_expanded, colors.secondaryTextColor)

                if (minWidth in 220..270) {
                    views.setViewVisibility(R.id.widget_btn_prev_expanded, View.GONE)
                    views.setViewVisibility(R.id.widget_btn_next_expanded, View.GONE)
                } else {
                    views.setViewVisibility(R.id.widget_btn_prev_expanded, View.VISIBLE)
                    views.setViewVisibility(R.id.widget_btn_next_expanded, View.VISIBLE)
                }
            } else {
                // Card layout:
                views.setViewVisibility(R.id.widget_compact_layout, View.GONE)
                views.setViewVisibility(R.id.widget_expanded_layout, View.GONE)
                views.setViewVisibility(R.id.widget_card_layout, View.VISIBLE)

                views.setTextViewText(R.id.widget_title_card, title)
                views.setTextColor(R.id.widget_title_card, colors.primaryTextColor)
                views.setTextViewText(R.id.widget_artist_card, artist)
                views.setTextColor(R.id.widget_artist_card, colors.secondaryTextColor)

                if (artworkBitmap != null) {
                    views.setImageViewBitmap(R.id.widget_art_card, artworkBitmap)
                } else {
                    views.setImageViewResource(R.id.widget_art_card, R.drawable.ic_widget_art_fallback)
                }

                views.setImageViewBitmap(R.id.widget_btn_play_pause_card, playPauseBitmap)
                views.setInt(R.id.widget_btn_prev_card, "setBackgroundResource", buttonBgRes)
                views.setInt(R.id.widget_btn_prev_card, "setColorFilter", buttonIconTint)
                views.setInt(R.id.widget_btn_next_card, "setBackgroundResource", buttonBgRes)
                views.setInt(R.id.widget_btn_next_card, "setColorFilter", buttonIconTint)

                views.setProgressBar(R.id.widget_progress_card, 1000, progressInt, false)
                views.setTextViewText(R.id.widget_time_elapsed_card, elapsedStr)
                views.setTextViewText(R.id.widget_time_total_card, totalStr)
                views.setTextColor(R.id.widget_time_elapsed_card, colors.secondaryTextColor)
                views.setTextColor(R.id.widget_time_total_card, colors.secondaryTextColor)

                if (minWidth in 1..180) {
                    views.setViewVisibility(R.id.widget_btn_prev_card, View.GONE)
                    views.setViewVisibility(R.id.widget_btn_next_card, View.GONE)
                } else {
                    views.setViewVisibility(R.id.widget_btn_prev_card, View.VISIBLE)
                    views.setViewVisibility(R.id.widget_btn_next_card, View.VISIBLE)
                }
            }

            // Bind click intents across all layouts:
            val playPauseIntent = Intent(context, NowPlayingWidgetProvider::class.java).apply {
                action = ACTION_PLAY_PAUSE
            }
            val playPausePI = PendingIntent.getBroadcast(
                context, 101, playPauseIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            views.setOnClickPendingIntent(R.id.widget_btn_play_pause, playPausePI)
            views.setOnClickPendingIntent(R.id.widget_btn_play_pause_expanded, playPausePI)
            views.setOnClickPendingIntent(R.id.widget_btn_play_pause_card, playPausePI)

            val prevIntent = Intent(context, NowPlayingWidgetProvider::class.java).apply {
                action = ACTION_PREV
            }
            val prevPI = PendingIntent.getBroadcast(
                context, 102, prevIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            views.setOnClickPendingIntent(R.id.widget_btn_prev, prevPI)
            views.setOnClickPendingIntent(R.id.widget_btn_prev_expanded, prevPI)
            views.setOnClickPendingIntent(R.id.widget_btn_prev_card, prevPI)

            val nextIntent = Intent(context, NowPlayingWidgetProvider::class.java).apply {
                action = ACTION_NEXT
            }
            val nextPI = PendingIntent.getBroadcast(
                context, 103, nextIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            views.setOnClickPendingIntent(R.id.widget_btn_next, nextPI)
            views.setOnClickPendingIntent(R.id.widget_btn_next_expanded, nextPI)
            views.setOnClickPendingIntent(R.id.widget_btn_next_card, nextPI)

            val openAppIntent = Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_NEW_TASK
            }
            val pendingOpen = PendingIntent.getActivity(
                context, 100, openAppIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            views.setOnClickPendingIntent(R.id.widget_now_playing_root, pendingOpen)

            appWidgetManager.updateAppWidget(appWidgetId, views)
        }
    }

    fun updateLyricsWidgets(context: Context) {
        ensurePrefsLoaded(context)
        val appWidgetManager = AppWidgetManager.getInstance(context) ?: return
        val componentName = ComponentName(context, LyricsWidgetProvider::class.java)
        val ids = appWidgetManager.getAppWidgetIds(componentName)
        if (ids.isEmpty()) return

        val isLight = themeMode.equals("light", ignoreCase = true)
        val colors = getOrComputeColors(isLight)
        val density = context.resources.displayMetrics.density

        val activeLyricColor = if (currentLyricText == "Not playing" || currentLyricText == "No lyrics available") {
            colors.primaryTextColor
        } else {
            colors.accentColor
        }
        val dimmedColor = if (isLight) {
            blendColors(colors.secondaryTextColor, Color.BLACK, 0.45f)
        } else {
            Color.parseColor("#71717A")
        }

        for (appWidgetId in ids) {
            // A distinct layout ID reinflates existing launcher widgets with the flexible lyric body.
            val views = RemoteViews(context.packageName, R.layout.widget_lyrics_lines)
            val options = appWidgetManager.getAppWidgetOptions(appWidgetId)
            val minHeight = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0)
            val minWidth = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0)

            // Dynamic rounded-rect background:
            val bgBitmap = createWidgetBackgroundBitmap(
                if (minWidth > 0) minWidth else 260,
                if (minHeight > 0) minHeight else 120,
                density,
                colors
            )
            views.setImageViewBitmap(R.id.widget_lyrics_bg_image, bgBitmap)

            // Header (shown when widget height >= 110dp):
            if (minHeight >= 110) {
                views.setViewVisibility(R.id.widget_lyrics_header, View.VISIBLE)
                val trackHeader = if (title != "Not Playing") title else "LUMAIRE · LYRICS"
                views.setTextViewText(R.id.widget_lyrics_track_info, trackHeader)
                views.setTextColor(R.id.widget_lyrics_track_info, colors.accentColor)
                views.setInt(R.id.widget_lyrics_indicator, "setColorFilter", colors.accentColor)
            } else {
                views.setViewVisibility(R.id.widget_lyrics_header, View.GONE)
            }

            // Lyric texts:
            views.setTextViewText(R.id.widget_lyrics_prev, prevLyricText)
            views.setTextColor(R.id.widget_lyrics_prev, dimmedColor)

            views.setTextViewText(R.id.widget_lyrics_current, currentLyricText)
            views.setTextColor(R.id.widget_lyrics_current, activeLyricColor)

            views.setTextViewText(R.id.widget_lyrics_next, nextLyricText)
            views.setTextColor(R.id.widget_lyrics_next, colors.secondaryTextColor)

            views.setBoolean(R.id.widget_lyrics_next2, "setSingleLine", false)
            views.setInt(R.id.widget_lyrics_next2, "setMaxLines", 48)
            views.setTextViewText(R.id.widget_lyrics_next2, next2LyricText)
            views.setTextColor(R.id.widget_lyrics_next2, colors.secondaryTextColor)

            val ticker = minHeight in 1..85
            views.setTextViewTextSize(R.id.widget_lyrics_current, TypedValue.COMPLEX_UNIT_SP, if (ticker) 14f else 17f)
            views.setTextViewTextSize(R.id.widget_lyrics_next, TypedValue.COMPLEX_UNIT_SP, 14f)
            views.setTextViewTextSize(R.id.widget_lyrics_next2, TypedValue.COMPLEX_UNIT_SP, 14f)
            views.setViewVisibility(R.id.widget_lyrics_prev,
                if (minHeight >= 210 && prevLyricText.isNotBlank()) View.VISIBLE else View.GONE)
            views.setViewVisibility(R.id.widget_lyrics_next,
                if (!ticker && nextLyricText.isNotBlank()) View.VISIBLE else View.GONE)
            views.setViewVisibility(R.id.widget_lyrics_next2,
                if (!ticker && next2LyricText.isNotBlank()) View.VISIBLE else View.GONE)

            val openAppIntent = Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_NEW_TASK
            }
            val pendingOpen = PendingIntent.getActivity(
                context, 200, openAppIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            views.setOnClickPendingIntent(R.id.widget_lyrics_root, pendingOpen)

            appWidgetManager.updateAppWidget(appWidgetId, views)
        }
    }
}
