package com.pstarx.kiosk.kiosk

import android.content.Context
import android.os.SystemClock
import android.provider.Settings
import android.util.Log
import android.webkit.CookieManager
import android.webkit.WebStorage
import android.webkit.WebView
import android.webkit.WebViewDatabase

/**
 * Sessão limpa a cada vez que o coletor liga: quem desliga o coletor sem sair do SSW deixava cookies e dados da página
 * guardados, e ao ligar o site abria "logado" (um login falso, que o SSW já tinha encerrado). No primeiro site aberto
 * depois de ligar, apaga cookies, dados da página (localStorage, IndexedDB), cache e histórico antes de carregar.
 *
 * Também serve à saída por inatividade (mesma limpeza, sem esperar o próximo boot).
 */
object SessionReset {
    private const val TAG = "SessionReset"
    private const val PREFS = "session"
    private const val KEY_BOOT = "cleaned_boot"

    /**
     * Identifica a ligação atual do aparelho: o contador de boots do Android; sem ele, a hora em que ligou (arredondada
     * ao minuto, para não variar com o relógio).
     */
    fun bootId(ctx: Context): String {
        val count = runCatching { Settings.Global.getInt(ctx.contentResolver, Settings.Global.BOOT_COUNT) }.getOrNull()
        if (count != null) return "n:$count"
        val bootedAt = System.currentTimeMillis() - SystemClock.elapsedRealtime()
        return "t:${bootedAt / 60_000}"
    }

    /** Ainda não limpou a sessão desde que o aparelho ligou. */
    fun pendingForBoot(ctx: Context): Boolean = needsClean(prefs(ctx).getString(KEY_BOOT, null), bootId(ctx))

    /** Regra (testável): limpa quando a ligação atual não é a última já limpa. */
    fun needsClean(cleanedBoot: String?, currentBoot: String): Boolean {
        if (cleanedBoot == currentBoot) return false
        // sem contador de boots, a hora do boot pode variar 1 min (relógio acertado pela rede): mesma ligação
        if (cleanedBoot != null && cleanedBoot.startsWith("t:") && currentBoot.startsWith("t:")) {
            val a = cleanedBoot.removePrefix("t:").toLongOrNull()
            val b = currentBoot.removePrefix("t:").toLongOrNull()
            if (a != null && b != null && kotlin.math.abs(a - b) <= 2) return false
        }
        return true
    }

    /**
     * Apaga a sessão do site e chama `done` (na thread principal) quando os cookies já foram removidos de verdade.
     * `forBoot` marca esta ligação como limpa (só depois de terminar: se o app cair no meio, limpa de novo).
     */
    fun clear(ctx: Context, view: WebView?, forBoot: Boolean, done: () -> Unit) {
        val app = ctx.applicationContext
        val boot = if (forBoot) bootId(app) else null
        WebStorage.getInstance().deleteAllData()
        runCatching {
            WebViewDatabase.getInstance(app).clearHttpAuthUsernamePassword()
            @Suppress("DEPRECATION")
            WebViewDatabase.getInstance(app).clearFormData()
        }
        view?.clearCache(true)
        view?.clearHistory()
        view?.clearFormData()
        val cookies = CookieManager.getInstance()
        cookies.removeSessionCookies(null)
        cookies.removeAllCookies {
            cookies.flush()
            if (boot != null) prefs(app).edit().putString(KEY_BOOT, boot).apply()
            Log.i(TAG, if (forBoot) "Sessão do site apagada (coletor ligado)" else "Sessão do site apagada")
            done()
        }
    }

    private fun prefs(ctx: Context) = ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
}
