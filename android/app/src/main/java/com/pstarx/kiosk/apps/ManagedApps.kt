package com.pstarx.kiosk.apps

import android.content.Context
import android.util.Log
import com.pstarx.kiosk.commands.Commands
import com.pstarx.kiosk.ops.OpsReader
import com.pstarx.kiosk.panel.PanelSync
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Apps gerenciados pelo painel (os do perfil e o próprio app do kiosk quando há versão nova): o check-in traz a
 * lista com a versão mais nova; o que estiver faltando ou mais velho é instalado. Nunca rebaixa, nunca remove.
 * Falhou: tenta de novo com espera crescente (5 min → 6 h) para não baixar o mesmo APK a cada 30 s.
 */
object ManagedApps {
    private const val TAG = "ManagedApps"
    private const val BASE_RETRY_MS = 5 * 60_000L
    private const val MAX_RETRY_MS = 6 * 60 * 60_000L
    private val busy = AtomicBoolean(false)

    private fun prefs(ctx: Context) = ctx.getSharedPreferences("managed_apps", Context.MODE_PRIVATE)

    /** Espera antes de tentar de novo depois de `failures` falhas seguidas. Exposto para teste. */
    fun retryDelayMs(failures: Int): Long = minOf(MAX_RETRY_MS, BASE_RETRY_MS shl (failures - 1).coerceIn(0, 10))

    /** Lista recebida no check-in. Instala em segundo plano, na fila dos comandos. */
    fun reconcile(context: Context, list: JSONArray) {
        val ctx = context.applicationContext
        val artifacts = (0 until list.length()).mapNotNull { i -> list.optJSONObject(i)?.let { runCatching { Artifact.fromJson(it) }.getOrNull() } }
        prefs(ctx).edit().putString("desired", JSONArray(artifacts.map { it.packageName }).toString()).apply()
        val installer = AppInstaller(ctx)
        // o próprio app por último: instalar encerra o processo
        val todo = artifacts.filter { (installer.installedVersion(it.packageName) ?: -1) < it.versionCode && retryAllowed(ctx, it) }
            .sortedBy { it.packageName == ctx.packageName }
        if (todo.isEmpty() || !busy.compareAndSet(false, true)) return
        Commands.worker.execute {
            var attempted = false
            try {
                for (a in todo) {
                    // atualizar o próprio app reinicia a tela: espera o colaborador sair da bipagem (próximo check-in)
                    if (a.packageName == ctx.packageName && OpsReader.isBusy()) {
                        Log.i(TAG, "Atualização do app adiada: bipagem em andamento")
                        continue
                    }
                    attempted = true
                    Log.i(TAG, "Instalando ${a.packageName} ${a.versionCode}")
                    val r = installer.install(a)
                    record(ctx, a, r)
                    Log.i(TAG, "${a.packageName}: $r")
                }
            } finally {
                busy.set(false)
                if (attempted) PanelSync.now(ctx, "managed-apps")
            }
        }
    }

    private fun retryAllowed(ctx: Context, a: Artifact): Boolean {
        val f = failure(ctx, a.packageName) ?: return true
        if (f.optString("sha256") != a.sha256) return true // versão nova: tenta já
        return System.currentTimeMillis() - f.optLong("atMs") >= retryDelayMs(f.optInt("failures", 1))
    }

    private fun failure(ctx: Context, pkg: String): JSONObject? =
        prefs(ctx).getString("fail:$pkg", null)?.let { runCatching { JSONObject(it) }.getOrNull() }

    private fun record(ctx: Context, a: Artifact, r: AppInstaller.Result) {
        val e = prefs(ctx).edit()
        when (r) {
            is AppInstaller.Result.Ok -> e.remove("fail:${a.packageName}")
            is AppInstaller.Result.Failed -> {
                val prev = failure(ctx, a.packageName)
                val failures = if (prev?.optString("sha256") == a.sha256) prev.optInt("failures", 0) + 1 else 1
                e.putString(
                    "fail:${a.packageName}",
                    JSONObject().put("sha256", a.sha256).put("versionCode", a.versionCode).put("error", r.message)
                        .put("failures", failures).put("atMs", System.currentTimeMillis()).toString(),
                )
            }
        }
        e.commit()
    }

    /** Situação para o painel: versão instalada de cada app gerenciado e o último erro (se houver). */
    fun status(ctx: Context): JSONObject {
        val desired = runCatching { JSONArray(prefs(ctx).getString("desired", "[]")) }.getOrDefault(JSONArray())
        val installer = AppInstaller(ctx)
        val out = JSONObject()
        val iso = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }
        for (i in 0 until desired.length()) {
            val pkg = desired.optString(i)
            val f = failure(ctx, pkg)
            out.put(pkg, JSONObject().apply {
                put("versionCode", installer.installedVersion(pkg) ?: JSONObject.NULL)
                put("error", f?.let { "versão ${it.optLong("versionCode")}: ${it.optString("error")}" } ?: JSONObject.NULL)
                if (f != null) put("at", iso.format(Date(f.optLong("atMs"))))
            })
        }
        return out
    }
}
