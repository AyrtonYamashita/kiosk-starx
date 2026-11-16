package com.pstarx.kiosk.kiosk

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.content.pm.ActivityInfo
import android.graphics.Color
import android.net.http.SslError
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import android.util.TypedValue
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.WindowManager
import android.webkit.SslErrorHandler
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.GridLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import com.pstarx.kiosk.config.KioskConfig
import com.pstarx.kiosk.security.TapCounter
import com.pstarx.kiosk.ui.PinActivity

/**
 * Tela do kiosk: launcher padrão enquanto o kiosk está ligado, sempre em lock task.
 *
 *  - App único: abre o app e o reabre sozinho se ele fechar ou travar (o intervalo cresce se ele cair em sequência).
 *  - Grade: ícones dos apps liberados; o botão Home volta para cá.
 *  - Site: WebView em tela cheia, recarrega após erro e volta à página inicial após inatividade.
 *
 * Em qualquer modo, N toques rápidos no canto configurado abrem o pedido de PIN.
 */
class KioskActivity : Activity() {
    private lateinit var kiosk: KioskController
    private val handler = Handler(Looper.getMainLooper())
    private lateinit var root: FrameLayout
    private var config = KioskConfig()
    private var renderedKey: String? = null
    private var webView: WebView? = null

    /** O app único foi aberto daqui: voltar para esta tela significa que ele fechou (ou travou). */
    private var launchedApp = false
    private var resumed = false
    private val restarts = ArrayDeque<Long>()
    private var countdown: Runnable? = null
    private val inactivity = Runnable { webView?.loadUrl(config.kiosk.web.url) }
    private val onChange: () -> Unit = { if (resumed) refresh() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        kiosk = KioskController.get(this)
        root = FrameLayout(this)
        setContentView(root)
        kiosk.addListener(onChange)
    }

    override fun onDestroy() {
        kiosk.removeListener(onChange)
        handler.removeCallbacksAndMessages(null)
        webView?.destroy()
        super.onDestroy()
    }

    /** Trazida para a frente pelo controlador (configuração nova): não é o app que fechou. */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        launchedApp = false
    }

    override fun onResume() {
        super.onResume()
        resumed = true
        hideSystemBars()
        if (!kiosk.enforced) {
            leave()
            return
        }
        ensureLockTask()
        refresh()
        if (config.kiosk.mode == KioskConfig.Mode.APP) {
            if (kiosk.restartAppPending) {
                // "recarregar" do painel: o app já foi para segundo plano; encerra e abre de novo (sem contar como queda)
                kiosk.restartAppPending = false
                config.kiosk.app?.let { pkg ->
                    handler.postDelayed({ runCatching { getSystemService(android.app.ActivityManager::class.java).killBackgroundProcesses(pkg) } }, 300)
                }
                launchedApp = false
                scheduleLaunch(returning = false, forceDelayMs = 1_500)
            } else {
                // voltando da administração: reabre logo, sem contar como queda
                val fromAdmin = SystemClock.uptimeMillis() - kiosk.adminClosedAtUptime < 3_000
                scheduleLaunch(returning = launchedApp && !fromAdmin)
            }
        }
        launchedApp = false
    }

    override fun onPause() {
        resumed = false
        cancelCountdown()
        super.onPause()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) hideSystemBars()
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        val wv = webView
        if (wv != null && wv.canGoBack()) wv.goBack()
    }

    override fun dispatchTouchEvent(ev: MotionEvent): Boolean {
        if (ev.actionMasked == MotionEvent.ACTION_DOWN) restartInactivity()
        return super.dispatchTouchEvent(ev)
    }

    private fun ensureLockTask() {
        if (!kiosk.inLockTask) runCatching { startLockTask() }.onFailure { Log.w(TAG, "startLockTask: ${it.message}") }
    }

    /** Kiosk desligado: sai do lock task e fecha. */
    private fun leave() {
        runCatching { stopLockTask() }
        finishAndRemoveTask()
    }

    // ---------------------------------------------------------------- telas

    private fun refresh() {
        if (!kiosk.enforced) {
            leave()
            return
        }
        val previousMode = config.kiosk.mode
        config = kiosk.config
        applyWindow()
        // redesenha só se algo visível mudou (evita recarregar o site a cada aviso)
        val key = listOf(config.kiosk, config.appearance, config.security.exitCorner, config.security.exitTaps, appsVersion, kiosk.reloadNonce).toString()
        if (key == renderedKey) return
        renderedKey = key
        root.removeAllViews()
        webView?.destroy()
        webView = null
        root.setBackgroundColor(parseColor(config.appearance.backgroundColor, Color.rgb(16, 24, 40)))
        when (config.kiosk.mode) {
            KioskConfig.Mode.APPS -> root.addView(gridScreen())
            KioskConfig.Mode.APP -> root.addView(singleAppScreen())
            KioskConfig.Mode.WEB -> root.addView(webScreen())
        }
        root.addView(cornerZone())
        if (previousMode == KioskConfig.Mode.APP && config.kiosk.mode != KioskConfig.Mode.APP) cancelCountdown()
    }

    /** Muda quando apps são instalados/removidos (o controlador avisa; a grade precisa redesenhar). */
    private val appsVersion: Int
        get() = config.kioskPackages().count { packageManager.getLaunchIntentForPackage(it) != null }

    private fun applyWindow() {
        requestedOrientation = when (config.display.orientation) {
            KioskConfig.Orientation.AUTO -> ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
            KioskConfig.Orientation.PORTRAIT -> ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT
            KioskConfig.Orientation.LANDSCAPE -> ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
        }
        if (config.display.keepScreenOn) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }

    /** Área invisível no canto: N toques rápidos abrem o pedido de PIN. */
    private fun cornerZone(): View {
        val counter = TapCounter(config.security.exitTaps)
        val gravity = when (config.security.exitCorner) {
            KioskConfig.Corner.TOP_LEFT -> Gravity.TOP or Gravity.START
            KioskConfig.Corner.TOP_RIGHT -> Gravity.TOP or Gravity.END
            KioskConfig.Corner.BOTTOM_LEFT -> Gravity.BOTTOM or Gravity.START
            KioskConfig.Corner.BOTTOM_RIGHT -> Gravity.BOTTOM or Gravity.END
        }
        return View(this).apply {
            isClickable = true
            contentDescription = "Administração"
            setOnTouchListener { _, ev ->
                if (ev.actionMasked == MotionEvent.ACTION_DOWN && counter.onTap(SystemClock.uptimeMillis())) openAdmin()
                true
            }
            layoutParams = FrameLayout.LayoutParams(dp(64), dp(64), gravity)
        }
    }

    private fun openAdmin() {
        cancelCountdown()
        PinActivity.open(this)
    }

    private fun header(): View? {
        val title = config.appearance.title
        if (title.isBlank()) return null
        return TextView(this).apply {
            text = title
            setTextColor(parseColor(config.appearance.textColor, Color.WHITE))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 22f)
            setPadding(dp(20), dp(20), dp(20), dp(8))
        }
    }

    private fun gridScreen(): View {
        val text = parseColor(config.appearance.textColor, Color.WHITE)
        val columns = config.appearance.columns
        val column = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        header()?.let { column.addView(it) }
        val grid = GridLayout(this).apply {
            columnCount = columns
            setPadding(dp(8), dp(8), dp(8), dp(8))
        }
        // largura fixa por coluna: com menos apps que colunas, a grade não estica
        val cellWidth = (resources.displayMetrics.widthPixels - dp(16)) / columns
        val pm = packageManager
        val apps = config.kiosk.apps.mapNotNull { pkg -> pm.getLaunchIntentForPackage(pkg)?.let { pkg to it } }
        for ((pkg, launch) in apps) {
            val info = runCatching { pm.getApplicationInfo(pkg, 0) }.getOrNull() ?: continue
            val cell = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.CENTER_HORIZONTAL
                setPadding(dp(4), dp(14), dp(4), dp(14))
                isClickable = true
                isFocusable = true
                setOnClickListener { startApp(pkg, launch) }
            }
            cell.addView(ImageView(this).apply { setImageDrawable(pm.getApplicationIcon(info)) }, LinearLayout.LayoutParams(dp(60), dp(60)))
            cell.addView(TextView(this).apply {
                this.text = pm.getApplicationLabel(info)
                setTextColor(text)
                gravity = Gravity.CENTER
                maxLines = 2
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
                setPadding(0, dp(6), 0, 0)
            })
            grid.addView(cell, GridLayout.LayoutParams().apply { width = cellWidth })
        }
        if (apps.isEmpty()) {
            column.addView(message("Nenhum app da grade está instalado.\nToque ${config.security.exitTaps}x no canto ${config.security.exitCorner.label.lowercase()} para configurar.", text))
        }
        column.addView(ScrollView(this).apply { addView(grid) }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
        return column
    }

    private fun singleAppScreen(): View {
        val text = parseColor(config.appearance.textColor, Color.WHITE)
        val column = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        header()?.let { column.addView(it) }
        val pkg = config.kiosk.app
        val label = pkg?.let { appLabelOrNull(it) }
        val msg = when {
            pkg == null -> "Nenhum app definido.\nToque ${config.security.exitTaps}x no canto ${config.security.exitCorner.label.lowercase()} para configurar."
            label == null -> "O app $pkg não está instalado.\nAguardando a instalação."
            else -> "Abrindo $label…"
        }
        column.addView(message(msg, text).apply { tag = STATUS_TAG }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
        return column
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun webScreen(): View {
        val web = config.kiosk.web
        if (web.url.isBlank()) {
            return message(
                "Nenhum site definido.\nToque ${config.security.exitTaps}x no canto ${config.security.exitCorner.label.lowercase()} para configurar.",
                parseColor(config.appearance.textColor, Color.WHITE),
            )
        }
        val wv = WebView(this)
        wv.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            builtInZoomControls = web.allowZoom
            displayZoomControls = false
            setSupportZoom(web.allowZoom)
            loadWithOverviewMode = true
            useWideViewPort = true
        }
        wv.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                // só http(s) dentro do kiosk: tel:, intent:, market: etc. abririam outros apps
                val scheme = request.url.scheme?.lowercase()
                return scheme != "http" && scheme != "https"
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (!request.isForMainFrame) return
                Log.w(TAG, "Erro ao carregar ${request.url}: ${error.description}")
                scheduleReload(view)
            }

            override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) {
                Log.w(TAG, "Certificado inválido em ${error.url}")
                handler.cancel()
                scheduleReload(view)
            }
        }
        wv.loadUrl(web.url)
        webView = wv
        restartInactivity()
        return wv
    }

    private fun scheduleReload(view: WebView) {
        val sec = config.kiosk.web.reloadOnErrorSec
        if (sec <= 0) return
        handler.postDelayed({ if (webView === view) view.reload() }, sec * 1000L)
    }

    private fun restartInactivity() {
        handler.removeCallbacks(inactivity)
        val sec = config.kiosk.web.inactivityReturnSec
        if (config.kiosk.mode == KioskConfig.Mode.WEB && sec > 0 && webView != null) handler.postDelayed(inactivity, sec * 1000L)
    }

    private fun message(s: String, color: Int) = TextView(this).apply {
        text = s
        setTextColor(color)
        gravity = Gravity.CENTER
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 18f)
        setPadding(dp(24), dp(24), dp(24), dp(24))
    }

    // ---------------------------------------------------------------- app único

    /**
     * Abre o app. Na primeira vez, quase direto; quando o app fechou (voltou para cá), espera alguns segundos
     * (dá tempo de chegar no canto) e conta a reabertura. Caiu 5 vezes em 2 min: espera 30 s.
     */
    private fun scheduleLaunch(returning: Boolean, forceDelayMs: Long? = null) {
        cancelCountdown()
        val pkg = config.kiosk.app ?: return
        val launch = packageManager.getLaunchIntentForPackage(pkg) ?: return
        var delayMs = forceDelayMs ?: if (returning) config.kiosk.relaunchDelaySec * 1000L else 500L
        if (returning) {
            val now = SystemClock.elapsedRealtime()
            restarts.addLast(now)
            while (restarts.isNotEmpty() && now - restarts.first() > CRASH_WINDOW_MS) restarts.removeFirst()
            if (restarts.size >= CRASH_LIMIT) delayMs = maxOf(delayMs, CRASH_BACKOFF_MS)
        }
        val deadline = SystemClock.elapsedRealtime() + delayMs
        val tick = object : Runnable {
            override fun run() {
                if (!resumed) return
                val left = deadline - SystemClock.elapsedRealtime()
                if (left <= 0) {
                    startApp(pkg, launch)
                    return
                }
                root.findViewWithTag<TextView>(STATUS_TAG)?.text = "Abrindo ${appLabelOrNull(pkg) ?: pkg} em ${(left + 999) / 1000} s…"
                handler.postDelayed(this, 250)
            }
        }
        countdown = tick
        handler.post(tick)
    }

    private fun cancelCountdown() {
        countdown?.let { handler.removeCallbacks(it) }
        countdown = null
    }

    private fun startApp(pkg: String, launch: Intent) {
        try {
            startActivity(Intent(launch).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            launchedApp = config.kiosk.mode == KioskConfig.Mode.APP
        } catch (e: Exception) {
            Log.w(TAG, "Não abriu $pkg: ${e.message}")
            root.findViewWithTag<TextView>(STATUS_TAG)?.text = "Não foi possível abrir ${appLabelOrNull(pkg) ?: pkg}."
        }
    }

    private fun appLabelOrNull(pkg: String): CharSequence? =
        runCatching { packageManager.getApplicationLabel(packageManager.getApplicationInfo(pkg, 0)) }.getOrNull()

    // ---------------------------------------------------------------- utilidades

    private fun hideSystemBars() {
        if (config.display.showStatusBar || config.security.allowNotifications) return
        if (Build.VERSION.SDK_INT >= 30) {
            window.insetsController?.let {
                it.hide(WindowInsets.Type.systemBars())
                it.systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }
        } else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or View.SYSTEM_UI_FLAG_FULLSCREEN or
                View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_LAYOUT_STABLE or
                View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
        }
    }

    private fun parseColor(hex: String, fallback: Int) = runCatching { Color.parseColor(hex) }.getOrDefault(fallback)

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    private companion object {
        const val TAG = "KioskActivity"
        const val STATUS_TAG = "status"
        const val CRASH_WINDOW_MS = 2 * 60_000L
        const val CRASH_LIMIT = 5
        const val CRASH_BACKOFF_MS = 30_000L
    }
}
