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
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.SslErrorHandler
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.GridLayout
import android.widget.Button
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import com.pstarx.kiosk.config.KioskConfig
import com.pstarx.kiosk.ops.OpsReader
import com.pstarx.kiosk.panel.PanelStore
import com.pstarx.kiosk.security.TapCounter
import com.pstarx.kiosk.ui.PinActivity
import com.pstarx.kiosk.ui.Theme
import com.pstarx.kiosk.ui.Ui

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
    private val inactivity = Runnable { if (gate == null) webView?.loadUrl(config.kiosk.web.url) }
    private val onChange: () -> Unit = { if (resumed) refresh() }
    /** Piloto da leitura do SSW ligado/desligado no painel: liga ou para o leitor sem recarregar o site. */
    private val onPanelChange: () -> Unit = { applyOps() }
    /** Leitor novo entregue pela API: substitui o que está na página aberta (o leitor troca a versão antiga sozinho). */
    /** Leitor novo da API: entra na página aberta, mas só depois da carga aberta terminar (não muda nada no meio dela). */
    private val onReaderChange: () -> Unit = { if (OpsReader.isBusy()) readerPending = true else webView?.let { injectReader(it) } }
    private var readerPending = false
    /** Mudança que recarregaria a página (configuração nova, "recarregar" do painel) esperando a carga aberta terminar. */
    private var refreshPending = false
    private val onBusyEnd: () -> Unit = {
        if (refreshPending) {
            refreshPending = false
            if (resumed) refresh()
        }
        if (readerPending) {
            readerPending = false
            webView?.let { injectReader(it) }
        }
    }
    /** Endereço da página principal (lido pela ponte do leitor, fora da thread principal). */
    @Volatile private var pageUrl: String? = null

    /** Operador parado no SSW: aviso de 30 s e saída (kiosk.web.idleLogoutMin). */
    private val idle = IdleLogout()
    private var idleOverlay: View? = null
    private var seenScanActivity = 0L
    private var idleButton: Button? = null
    private val idleTick = object : Runnable {
        override fun run() {
            tickIdle()
            handler.postDelayed(this, 1_000)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        kiosk = KioskController.get(this)
        root = FrameLayout(this)
        setContentView(root)
        kiosk.addListener(onChange)
        PanelStore.get(this).addListener(onPanelChange)
        OpsReader.onScriptChanged = onReaderChange
        OpsReader.onBusyEnd = onBusyEnd
        IdleAlarmReceiver.onFire = onIdleAlarm
    }

    override fun onDestroy() {
        IdleVibration.stop(this)
        kiosk.removeListener(onChange)
        PanelStore.get(this).removeListener(onPanelChange)
        if (OpsReader.onScriptChanged === onReaderChange) OpsReader.onScriptChanged = null
        if (OpsReader.onBusyEnd === onBusyEnd) OpsReader.onBusyEnd = null
        if (IdleAlarmReceiver.onFire === onIdleAlarm) IdleAlarmReceiver.onFire = null
        IdleAlarmReceiver.cancel(this)
        OpsReader.stop()
        gate?.stop()
        gate = null
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
        OpsReader.onScreen(true)
        // acender a tela não é uso: quem passou do prazo com a tela apagada sai agora (ou vê o aviso com o que sobrou)
        IdleAlarmReceiver.cancel(this)
        // mudanças da página com a tela apagada não são leituras do colaborador
        seenScanActivity = OpsReader.scanActivity
        handler.removeCallbacks(idleTick)
        tickIdle()
        handler.postDelayed(idleTick, 1_000)
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
        IdleVibration.stop(this)
        cancelCountdown()
        handler.removeCallbacks(idleTick)
        // tela apagada: o servidor fica sabendo na hora (o card mostra "tela apagada" em vez de "sem sinal")
        if (getSystemService(android.os.PowerManager::class.java)?.isInteractive == false) OpsReader.onScreen(false)
        // tela apagada (ou outra tela por cima): o prazo continua correndo; o alarme desconecta se ninguém voltar
        val (eligible, limitMs) = idleRule()
        if (eligible) idle.logoutAt(limitMs)?.let { IdleAlarmReceiver.schedule(this, it) }
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

    /** Toque que só acordou a tela escurecida: o gesto inteiro é ignorado (não clica no site nem na grade). */
    private var swallowGesture = false

    override fun dispatchTouchEvent(ev: MotionEvent): Boolean {
        if (ev.actionMasked == MotionEvent.ACTION_DOWN) {
            // aviso de inatividade aberto: qualquer toque para a vibração (o aviso continua até confirmar)
            IdleVibration.stop(this)
            restartInactivity()
            idle.activity(SystemClock.elapsedRealtime())
            swallowGesture = ScreenDimmer.onUserActivity()
        }
        if (swallowGesture) {
            if (ev.actionMasked == MotionEvent.ACTION_UP || ev.actionMasked == MotionEvent.ACTION_CANCEL) swallowGesture = false
            return true
        }
        return super.dispatchTouchEvent(ev)
    }

    /** Tecla física ou leitor de código que digita como teclado: conta como atividade do operador. */
    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (event.action == KeyEvent.ACTION_DOWN) idle.activity(SystemClock.elapsedRealtime())
        return super.dispatchKeyEvent(event)
    }

    // ---------------------------------------------------------------- operador parado no SSW

    private fun tickIdle() {
        val now = SystemClock.elapsedRealtime()
        // leituras na bipagem contam como uso (o leitor de código nem sempre chega aqui como tecla)
        val scans = OpsReader.scanActivity
        if (scans != seenScanActivity) {
            seenScanActivity = scans
            idle.activity(now)
        }
        val (eligible, limitMs) = idleRule()
        when (idle.tick(now, limitMs, eligible)) {
            IdleLogout.Action.SHOW -> showIdle(now)
            IdleLogout.Action.UPDATE -> updateIdle(now)
            IdleLogout.Action.HIDE -> hideIdle()
            IdleLogout.Action.LOGOUT -> {
                hideIdle()
                logoutSsw()
            }
            IdleLogout.Action.NONE -> Unit
        }
    }

    /** Conta a inatividade (alguém logado no SSW, modo site) e o prazo da tela aberta. */
    private fun idleRule(): Pair<Boolean, Long> {
        val url = pageUrl
        val eligible = config.kiosk.mode == KioskConfig.Mode.WEB && webView != null && IdleLogout.loggedIn(url, OpsReader.isSswUrl(url))
        // na bipagem o prazo é maior (o colaborador pode estar movendo volumes sem tocar no coletor)
        val limitMin = if (IdleLogout.scanningUrl(url)) config.kiosk.web.idleLogoutScanMin else config.kiosk.web.idleLogoutMin
        return eligible to limitMin * 60_000L
    }

    /** Alarme do prazo com a tela apagada: desconecta sem mostrar aviso (não tem ninguém olhando). */
    private val onIdleAlarm: () -> Unit = {
        if (!resumed) {
            val (eligible, limitMs) = idleRule()
            when (idle.tick(SystemClock.elapsedRealtime(), limitMs, eligible)) {
                IdleLogout.Action.LOGOUT -> {
                    hideIdle()
                    wakeScreen()
                    logoutSsw()
                }
                // acordou antes do prazo (alarme adiantado pelo Android): agenda de novo
                IdleLogout.Action.SHOW, IdleLogout.Action.UPDATE -> idle.logoutAt(limitMs)?.let { IdleAlarmReceiver.schedule(this, it) }
                else -> Unit
            }
        }
    }

    /**
     * Acende a tela (saída por inatividade com a tela apagada): o colaborador vê que foi desconectado e, com o coletor
     * acordado, o "saiu" chega ao servidor na hora. A tela volta a apagar sozinha pelo tempo normal do aparelho.
     */
    @Suppress("DEPRECATION")
    private fun wakeScreen() {
        runCatching {
            val pm = getSystemService(android.os.PowerManager::class.java)
            pm.newWakeLock(
                android.os.PowerManager.SCREEN_BRIGHT_WAKE_LOCK or android.os.PowerManager.ACQUIRE_CAUSES_WAKEUP or android.os.PowerManager.ON_AFTER_RELEASE,
                "starx:idle-logout",
            ).acquire(10_000)
        }.onFailure { Log.w(TAG, "Não acendeu a tela: ") }
    }

    private fun idleLabel(now: Long) = "Confirmo minha presença (${idle.secondsLeft(now)})"

    /** Aviso por cima do site: só o botão confirma; o resto da tela não responde enquanto ele está aberto. */
    private fun showIdle(now: Long) {
        hideIdle()
        ScreenDimmer.onUserActivity()
        val button = Ui.button(this, idleLabel(now), Ui.Variant.PRIMARY) {
            idle.confirm(SystemClock.elapsedRealtime())
            hideIdle()
        }
        val card = Ui.card(this).apply {
            setPadding(dp(20), dp(20), dp(20), dp(20))
            addView(Ui.text(this@KioskActivity, "Usuário Inativo!", Theme.Type.SECTION_TITLE))
            addView(Ui.note(this@KioskActivity, "Você será desconectado automaticamente caso não confirme em 30s.").apply { setPadding(0, dp(8), 0, dp(16)) })
            addView(button, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        }
        val overlay = FrameLayout(this).apply {
            setBackgroundColor(Theme.withAlpha(Color.BLACK, 0.6f))
            isClickable = true
            isFocusable = true
            addView(card, FrameLayout.LayoutParams(minOf(dp(340), resources.displayMetrics.widthPixels - dp(48)), FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.CENTER))
        }
        root.addView(overlay, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        idleOverlay = overlay
        idleButton = button
        IdleVibration.start(this)
        Log.i(TAG, "Operador parado: aviso de inatividade")
    }

    private fun updateIdle(now: Long) {
        val overlay = idleOverlay ?: return showIdle(now)
        // a tela foi redesenhada (configuração nova): o aviso volta por cima
        if (overlay.parent == null) root.addView(overlay, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        idleButton?.text = idleLabel(now)
    }

    private fun hideIdle() {
        IdleVibration.stop(this)
        idleOverlay?.let { root.removeView(it) }
        idleOverlay = null
        idleButton = null
    }

    /** Sai do SSW: apaga a sessão (cookies e dados da página) e volta à página inicial do site. */
    private fun logoutSsw() {
        Log.i(TAG, "Operador parado: saindo do SSW")
        val wv = webView
        // a página inicial só abre depois de os cookies terem saído de verdade (senão ela podia voltar logada)
        SessionReset.clear(this, wv, forBoot = false) {
            if (wv != null && webView === wv) wv.loadUrl(config.kiosk.web.url)
        }
    }

    /** Ponte da página: digitação e rolagem dentro do site (o teclado da tela não passa pelos toques desta tela). */
    private inner class IdleBridge {
        @JavascriptInterface
        fun activity() {
            handler.post { idle.activity(SystemClock.elapsedRealtime()) }
        }
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
        val key = listOf(config.kiosk, config.appearance, config.security.exitCorner, config.security.exitTaps, appsVersion, kiosk.reloadNonce, systemBarsHidden).toString()
        if (key == renderedKey) return
        // carga aberta no site: redesenhar recarregaria a página e tiraria o colaborador da bipagem; espera ela terminar
        if (webView != null && previousMode == KioskConfig.Mode.WEB && OpsReader.isBusy()) {
            refreshPending = true
            return
        }
        refreshPending = false
        renderedKey = key
        root.removeAllViews()
        gate?.stop()
        gate = null
        webView?.destroy()
        webView = null
        loaderView = null
        pageUrl = null
        root.setBackgroundColor(parseColor(config.appearance.backgroundColor, Theme.NIGHT))
        val screen = when (config.kiosk.mode) {
            KioskConfig.Mode.APPS -> gridScreen()
            KioskConfig.Mode.APP -> singleAppScreen()
            KioskConfig.Mode.WEB -> webScreen()
        }
        // barra do Android escondida: a barra própria (rede, sinal, bateria, hora) fica no rodapé
        root.addView(LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            addView(screen, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
            if (systemBarsHidden) {
                addView(
                    StatusFooter(this@KioskActivity, onReload = if (showReloadButton) ({ reloadPage() }) else null, lowPercent = config.display.lowBatteryPercent),
                    LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(Theme.FOOTER)),
                )
            }
        })
        // sem o rodapé, o atalho de recarregar fica flutuando num canto de baixo (o oposto ao do gesto)
        if (showReloadButton && !systemBarsHidden) root.addView(floatingReload())
        root.addView(cornerZone())
        if (previousMode == KioskConfig.Mode.APP && config.kiosk.mode != KioskConfig.Mode.APP) cancelCountdown()
        applyOps()
    }

    // ---------------------------------------------------------------- leitura do SSW (fase 2.4)

    /** Liga o leitor quando há site aberto e a leitura está ligada no painel; senão para (e tira o leitor da página). */
    private fun applyOps() {
        val wv = webView
        if (wv != null && config.kiosk.mode == KioskConfig.Mode.WEB && OpsReader.enabled(this)) {
            if (!OpsReader.running) {
                OpsReader.start(this)
                injectReader(wv)
            }
        } else if (OpsReader.running) {
            OpsReader.stop()
            wv?.evaluateJavascript("window.__starxOps && window.__starxOps.stop()", null)
        }
    }

    private fun injectReader(view: WebView) {
        if (!OpsReader.running || !OpsReader.isSswUrl(view.url)) return
        runCatching { view.evaluateJavascript(OpsReader.script(this), null) }.onFailure { Log.e(TAG, "Falha ao injetar o leitor do SSW", it) }
    }

    /** Muda quando apps são instalados/removidos (o controlador avisa; a grade precisa redesenhar). */
    private val appsVersion: Int
        get() = config.kioskPackages().count { packageManager.getLaunchIntentForPackage(it) != null }

    private fun applyWindow() {
        requestedOrientation = config.display.orientation.activityInfo
        if (config.screenAlwaysOn()) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
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
        // título de página: 24/600, -0.02em
        return Ui.text(this, title, Theme.Type.PAGE_TITLE, parseColor(config.appearance.textColor, Color.WHITE)).apply {
            setPadding(dp(16), dp(24), dp(16), dp(8))
        }
    }

    private fun gridScreen(): View {
        val text = parseColor(config.appearance.textColor, Color.WHITE)
        val columns = config.appearance.columns
        val column = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        header()?.let { column.addView(it) }
        val grid = GridLayout(this).apply {
            columnCount = columns
            setPadding(dp(12), dp(8), dp(12), dp(16))
        }
        // largura fixa por coluna: com menos apps que colunas, a grade não estica (gap de 8dp entre cartões)
        val cellWidth = (resources.displayMetrics.widthPixels - dp(24)) / columns
        val pm = packageManager
        val apps = config.kiosk.apps.mapNotNull { pkg -> pm.getLaunchIntentForPackage(pkg)?.let { pkg to it } }
        for ((pkg, launch) in apps) {
            val info = runCatching { pm.getApplicationInfo(pkg, 0) }.getOrNull() ?: continue
            // cartão do app: contorno de 1dp na cor do texto, raio 10, sem sombra; pressionado, um véu da mesma cor
            val tile = Theme.box(this, Theme.withAlpha(text, 0.04f), Theme.R_CARD, Theme.withAlpha(text, 0.16f))
            val cell = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.CENTER_HORIZONTAL
                setPadding(dp(6), dp(14), dp(6), dp(12))
                isClickable = true
                isFocusable = true
                background = android.graphics.drawable.RippleDrawable(
                    android.content.res.ColorStateList.valueOf(Theme.withAlpha(text, 0.12f)), tile, Theme.box(this@KioskActivity, Color.BLACK, Theme.R_CARD),
                )
                setOnClickListener { startApp(pkg, launch) }
            }
            cell.addView(ImageView(this).apply { setImageDrawable(pm.getApplicationIcon(info)) }, LinearLayout.LayoutParams(dp(52), dp(52)))
            cell.addView(Ui.text(this, pm.getApplicationLabel(info), Theme.Type.CONTROL, text).apply {
                gravity = Gravity.CENTER
                maxLines = 2
                ellipsize = android.text.TextUtils.TruncateAt.END
                setPadding(0, dp(8), 0, 0)
            })
            grid.addView(cell, GridLayout.LayoutParams().apply {
                width = cellWidth - dp(8)
                setMargins(dp(4), dp(4), dp(4), dp(4))
            })
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
        val loader = LoadingOverlay(this, parseColor(config.appearance.backgroundColor, Theme.NIGHT), parseColor(config.appearance.textColor, Color.WHITE))
        // ponte do leitor do SSW: só aceita chamadas com o piloto ligado e com a página principal no SSW
        wv.addJavascriptInterface(OpsReader.Bridge { OpsReader.isSswUrl(pageUrl) }, OpsReader.JS_NAME)
        wv.addJavascriptInterface(IdleBridge(), IDLE_JS_NAME)
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

            // fontes das telas do kiosk por cima do SSW (alerta, confirmação), servidas do APK: nada sai para a rede
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): android.webkit.WebResourceResponse? {
                val u = request.url
                if (u.path?.startsWith(KioskFonts.PATH) != true || !OpsReader.isSswUrl(u.toString())) return null
                return KioskFonts.response(applicationContext, u.lastPathSegment)
            }

            override fun onPageStarted(view: WebView, url: String?, favicon: android.graphics.Bitmap?) {
                webError = false
                pageUrl = url
                idle.activity(SystemClock.elapsedRealtime())
                if (!OpsReader.isSswUrl(url)) OpsReader.onLeftSsw()
            }

            override fun onPageFinished(view: WebView, url: String?) {
                pageUrl = url
                // terminou de "carregar" sem internet: é a página de erro do WebView (nem sempre vem onReceivedError)
                if (webView === view && gate == null && !online()) {
                    Log.w(TAG, "Página terminou sem internet: tela de espera")
                    webError = true
                    openWhenOnline(view, loader, forBoot = false)
                    return
                }
                if (webView === view) {
                    injectReader(view)
                    view.evaluateJavascript(IDLE_HOOK, null)
                }
            }

            override fun doUpdateVisitedHistory(view: WebView, url: String?, isReload: Boolean) {
                pageUrl = url
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (!request.isForMainFrame) return
                webError = true
                Log.w(TAG, "Erro ao carregar ${request.url}: ${error.description}")
                // caiu a internet: no lugar da página de erro, a tela de espera; volta ao início quando a rede voltar
                if (webView === view && !online()) openWhenOnline(view, loader, forBoot = false)
                else scheduleReload(view)
            }

            override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) {
                Log.w(TAG, "Certificado inválido em ${error.url}")
                webError = true
                handler.cancel()
                scheduleReload(view)
            }
        }
        webView = wv
        loaderView = loader
        openWhenOnline(wv, loader, forBoot = true)
        return FrameLayout(this).apply {
            addView(wv, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
            addView(loader, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        }
    }

    /** Espera pela internet (e não deixa a tela em branco ou com erro): fica em cima do site até abrir a página. */
    private var gate: ConnectionGate? = null
    private var loaderView: LoadingOverlay? = null

    /**
     * Abre a página inicial só com a internet funcionando e, na primeira vez depois de ligar o coletor, só depois de
     * apagar a sessão guardada (quem desligou sem sair do SSW não volta "logado").
     */
    private fun openWhenOnline(wv: WebView, loader: LoadingOverlay, forBoot: Boolean) {
        gate?.stop()
        gate = null
        handler.removeCallbacks(inactivity)
        val url = config.kiosk.web.url
        loader.show("Iniciando…", "")
        var online = false
        var clean = !(forBoot && SessionReset.pendingForBoot(this))
        val go = {
            if (online && clean && webView === wv) {
                loader.hide()
                wv.loadUrl(url)
                restartInactivity()
            }
        }
        if (!clean) {
            loader.show("Iniciando…", "Limpando a sessão anterior")
            SessionReset.clear(this, wv, forBoot = true) {
                clean = true
                go()
            }
        }
        val g = ConnectionGate(
            this,
            url,
            onStage = { _, title, detail -> if (webView === wv) loader.show(title, detail) },
            onReady = {
                online = true
                gate = null
                go()
            },
        )
        gate = g
        g.start()
    }

    /** O Android diz que há rede com internet (sem garantia de que o site responde). */
    private fun online(): Boolean {
        val cm = getSystemService(android.net.ConnectivityManager::class.java)
        val caps = cm.activeNetwork?.let { cm.getNetworkCapabilities(it) } ?: return false
        return caps.hasCapability(android.net.NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }

    /** Última carga da página principal falhou (o atalho então volta à URL inicial em vez de repetir a página com erro). */
    private var webError = false

    private val showReloadButton: Boolean
        get() = config.kiosk.mode == KioskConfig.Mode.WEB && config.kiosk.web.reloadButton && config.kiosk.web.url.isNotBlank()

    /** Atalho do operador: recarrega a página atual; se ela deu erro (ou não há página), volta à URL inicial. */
    private fun reloadPage() {
        val wv = webView ?: return
        // esperando a internet: a página abre sozinha quando conectar
        if (gate != null) return
        Log.i(TAG, "Recarregar pela tela (erro=$webError)")
        // sem internet: a tela de espera no lugar da página de erro (abre sozinha quando conectar)
        if (!online()) {
            loaderView?.let { openWhenOnline(wv, it, forBoot = false) }
            return
        }
        if (webError || wv.url.isNullOrBlank()) wv.loadUrl(config.kiosk.web.url) else wv.reload()
        restartInactivity()
    }

    /** Botão redondo de 40dp, superfície escura da paleta com contorno de 1dp, ícone de recarregar. */
    private fun floatingReload(): View {
        val bottomLeftTaken = config.security.exitCorner == KioskConfig.Corner.BOTTOM_LEFT
        return ImageView(this).apply {
            setImageResource(com.pstarx.kiosk.R.drawable.ic_reload)
            imageTintList = android.content.res.ColorStateList.valueOf(Theme.NIGHT_INK)
            scaleType = ImageView.ScaleType.CENTER_INSIDE
            setPadding(dp(10), dp(10), dp(10), dp(10))
            contentDescription = "Recarregar página"
            background = android.graphics.drawable.RippleDrawable(
                android.content.res.ColorStateList.valueOf(Theme.withAlpha(Theme.BLUE_SOFT, 0.3f)),
                Theme.box(this@KioskActivity, Theme.withAlpha(Theme.NIGHT_SURFACE, 0.9f), Theme.R_PILL, Theme.NIGHT_LINE),
                null,
            )
            elevation = Theme.dpf(this@KioskActivity, 2f)
            setOnClickListener { reloadPage() }
            layoutParams = FrameLayout.LayoutParams(dp(40), dp(40), Gravity.BOTTOM or if (bottomLeftTaken) Gravity.END else Gravity.START).apply {
                setMargins(dp(16), dp(16), dp(16), dp(16))
            }
        }
    }

    private fun scheduleReload(view: WebView) {
        val sec = config.kiosk.web.reloadOnErrorSec
        if (sec <= 0) return
        handler.postDelayed({ if (webView === view) view.reload() }, sec * 1000L)
    }

    private fun restartInactivity() {
        handler.removeCallbacks(inactivity)
        val sec = config.kiosk.web.inactivityReturnSec
        if (config.kiosk.mode == KioskConfig.Mode.WEB && sec > 0 && webView != null && gate == null) handler.postDelayed(inactivity, sec * 1000L)
    }

    /** Aviso centralizado na tela do kiosk: 13/600 (título de cartão), na cor do texto da aparência. */
    private fun message(s: String, color: Int) = Ui.text(this, s, Theme.Type.CARD_TITLE, color).apply {
        gravity = Gravity.CENTER
        setLineSpacing(0f, 1.45f)
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

    /** A barra do Android fica escondida (e a do rodapé aparece) sem "Barra de status" e sem "Notificações". */
    private val systemBarsHidden: Boolean
        get() = !config.display.showStatusBar && !config.security.allowNotifications

    private fun hideSystemBars() {
        if (!systemBarsHidden) return
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
        /** Ponte da atividade do operador na página (só registra que houve digitação ou rolagem). */
        private const val IDLE_JS_NAME = "StarXKiosk"
        private const val IDLE_HOOK =
            "(function(){if(window.__starxIdle)return;window.__starxIdle=1;var t=0;function a(){var n=Date.now();" +
                "if(n-t>3000){t=n;try{StarXKiosk.activity()}catch(e){}}}" +
                "['keydown','input','scroll','pointerdown'].forEach(function(e){document.addEventListener(e,a,true)});})()"
        const val TAG = "KioskActivity"
        const val STATUS_TAG = "status"
        const val CRASH_WINDOW_MS = 2 * 60_000L
        const val CRASH_LIMIT = 5
        const val CRASH_BACKOFF_MS = 30_000L
    }
}
