package com.pstarx.kiosk.panel

import android.content.Context
import android.os.Handler
import android.os.Looper

/** Estado da ligação com o painel (endereço, token, último contato). Fica só no aparelho. */
class PanelStore private constructor(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences("panel", Context.MODE_PRIVATE)
    private val main = Handler(Looper.getMainLooper())
    private val listeners = mutableSetOf<() -> Unit>()

    data class State(
        val serverUrl: String?,
        val deviceId: String?,
        val token: String?,
        val name: String?,
        val intervalSec: Int,
        val lastOkAt: Long,
        val lastErrorAt: Long,
        val lastError: String?,
        /** Removido no painel (o token deixou de valer): mostra o aviso até cadastrar de novo. */
        val removed: Boolean,
        /** O que o painel tem (resposta do último check-in): evita reenviar apps/configuração sem mudança. */
        val serverAppsHash: String?,
        val serverConfigRevision: Int?,
        /** Cadastro pendente (QR/ADB sem rede no momento): tentado a cada ciclo até dar certo. */
        val pendingUrl: String?,
        val pendingCode: String?,
        /** Hash da última configuração do painel aplicada aqui. */
        val appliedHash: String?,
        /** Resultado da última aplicação, ainda não enviado ao painel. */
        val pendingApplyResult: org.json.JSONObject?,
        /** Situação dos apps gerenciados enviada por último (só reenvia quando muda). */
        val sentManagedStatus: String?,
    ) {
        val enrolled get() = serverUrl != null && token != null
    }

    val state: State
        get() = State(
            serverUrl = prefs.getString("server_url", null),
            deviceId = prefs.getString("device_id", null),
            token = prefs.getString("token", null),
            name = prefs.getString("name", null),
            intervalSec = prefs.getInt("interval_sec", 60),
            lastOkAt = prefs.getLong("last_ok_at", 0),
            lastErrorAt = prefs.getLong("last_error_at", 0),
            lastError = prefs.getString("last_error", null),
            removed = prefs.getBoolean("removed", false),
            serverAppsHash = prefs.getString("server_apps_hash", null),
            serverConfigRevision = if (prefs.contains("server_config_revision")) prefs.getInt("server_config_revision", 0) else null,
            pendingUrl = prefs.getString("pending_url", null),
            pendingCode = prefs.getString("pending_code", null),
            appliedHash = prefs.getString("applied_hash", null),
            pendingApplyResult = prefs.getString("apply_result", null)?.let { runCatching { org.json.JSONObject(it) }.getOrNull() },
            sentManagedStatus = prefs.getString("sent_managed_status", null),
        )

    fun saveEnrollment(url: String, deviceId: String, token: String, name: String?, intervalSec: Int) {
        prefs.edit()
            .putString("server_url", url).putString("device_id", deviceId).putString("token", token)
            .putString("name", name).putInt("interval_sec", intervalSec.coerceIn(15, 3600))
            .putBoolean("removed", false)
            .remove("server_apps_hash").remove("server_config_revision")
            .remove("pending_url").remove("pending_code")
            .remove("applied_hash").remove("apply_result").remove("sent_managed_status")
            .remove("last_error").remove("last_error_at")
            .commit()
        notifyListeners()
    }

    fun setPending(url: String, code: String) {
        prefs.edit().putString("pending_url", url).putString("pending_code", code).commit()
    }

    fun clearPending() {
        prefs.edit().remove("pending_url").remove("pending_code").commit()
    }

    fun checkinOk(name: String?, intervalSec: Int, appsHash: String?, configRevision: Int?) {
        prefs.edit().apply {
            putLong("last_ok_at", System.currentTimeMillis())
            if (name != null) putString("name", name)
            putInt("interval_sec", intervalSec.coerceIn(15, 3600))
            if (appsHash != null) putString("server_apps_hash", appsHash) else remove("server_apps_hash")
            if (configRevision != null) putInt("server_config_revision", configRevision) else remove("server_config_revision")
            remove("last_error")
        }.commit()
        notifyListeners()
    }

    fun setApplied(hash: String, result: org.json.JSONObject) {
        prefs.edit().putString("applied_hash", hash).putString("apply_result", result.toString()).commit()
        notifyListeners()
    }

    fun setApplyFailed(result: org.json.JSONObject) {
        prefs.edit().putString("apply_result", result.toString()).commit()
        notifyListeners()
    }

    fun setSentManagedStatus(text: String) {
        prefs.edit().putString("sent_managed_status", text).apply()
    }

    fun clearApplyResult() {
        prefs.edit().remove("apply_result").commit()
    }

    fun checkinFailed(error: String) {
        prefs.edit().putLong("last_error_at", System.currentTimeMillis()).putString("last_error", error.take(200)).commit()
        notifyListeners()
    }

    fun removedByPanel() {
        prefs.edit().remove("token").remove("device_id").putBoolean("removed", true)
            .remove("server_apps_hash").remove("server_config_revision").commit()
        notifyListeners()
    }

    /** Desconectar (pela tela): esquece o painel. */
    fun clear() {
        prefs.edit().clear().commit()
        notifyListeners()
    }

    fun addListener(l: () -> Unit) = synchronized(listeners) { listeners += l }
    fun removeListener(l: () -> Unit) = synchronized(listeners) { listeners -= l }

    private fun notifyListeners() {
        val copy = synchronized(listeners) { listeners.toList() }
        main.post { copy.forEach { it() } }
    }

    companion object {
        @Volatile private var instance: PanelStore? = null

        fun get(context: Context): PanelStore =
            instance ?: synchronized(this) { instance ?: PanelStore(context).also { instance = it } }

        /** "kiosk.exemplo.com" → "https://kiosk.exemplo.com"; sem barra no fim. null se inválido. */
        fun normalizeUrl(raw: String): String? {
            var u = raw.trim()
            if (u.isEmpty()) return null
            if (!u.startsWith("http://", true) && !u.startsWith("https://", true)) u = "https://$u"
            val parsed = runCatching { java.net.URL(u) }.getOrNull() ?: return null
            if (parsed.host.isNullOrBlank()) return null
            return u.trimEnd('/')
        }
    }
}
