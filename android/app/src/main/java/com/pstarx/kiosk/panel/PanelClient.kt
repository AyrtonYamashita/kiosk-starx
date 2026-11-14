package com.pstarx.kiosk.panel

import android.content.Context
import android.util.Log
import com.pstarx.kiosk.BuildConfig
import com.pstarx.kiosk.config.ConfigStore
import com.pstarx.kiosk.config.KioskConfig
import com.pstarx.kiosk.device.DeviceInfo
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/**
 * Conversa com o painel (API na VPS): cadastro com o código e check-in periódico.
 * Chamadas bloqueantes: sempre fora da thread principal.
 */
class PanelClient(context: Context) {
    private val ctx = context.applicationContext
    private val store = PanelStore.get(ctx)

    sealed interface Result {
        data class Ok(val message: String) : Result
        data class Failed(val message: String) : Result
    }

    /** Cadastra com o código. Sucesso: guarda o token e já faz o primeiro check-in. */
    @Synchronized
    fun enroll(serverUrl: String, code: String): Result {
        val url = PanelStore.normalizeUrl(serverUrl) ?: return Result.Failed("endereço do painel inválido (use https://…)")
        val body = JSONObject()
            .put("code", code.trim().uppercase())
            .put("appVersion", BuildConfig.VERSION_NAME)
            .put("info", DeviceInfo(ctx).collect(includeApps = false))
        return try {
            val (status, json) = post("$url/v1/device/enroll", body, token = null)
            when (status) {
                200 -> {
                    store.saveEnrollment(url, json.getString("deviceId"), json.getString("token"), json.optString("name"), json.optInt("checkinIntervalSec", 60))
                    Log.i(TAG, "Cadastrado no painel $url como ${json.optString("name")}")
                    checkin()
                    Result.Ok("cadastrado como \"${json.optString("name")}\"")
                }
                403 -> Result.Failed(json.optString("message", "código inválido, expirado ou esgotado"))
                else -> Result.Failed("o painel respondeu HTTP $status")
            }
        } catch (e: IOException) {
            Result.Failed("sem conexão com o painel: ${e.message}")
        } catch (e: Exception) {
            Log.e(TAG, "Falha no cadastro", e)
            Result.Failed(e.message ?: e.javaClass.simpleName)
        }
    }

    /**
     * Check-in: inventário sempre; lista de apps e configuração só quando o painel não tem a versão atual
     * (a resposta anterior diz o que ele tem).
     */
    @Synchronized
    fun checkin(): Result {
        val s = store.state
        val url = s.serverUrl
        val token = s.token
        if (url == null || token == null) return Result.Failed("não cadastrado no painel")
        val info = DeviceInfo(ctx)
        val body = JSONObject()
            .put("appVersion", BuildConfig.VERSION_NAME)
            .put("info", info.collect(includeApps = false))

        val apps = info.apps()
        val appsHash = sha256(apps.toString())
        if (appsHash != s.serverAppsHash) body.put("apps", apps).put("appsHash", appsHash)

        val config = ConfigStore.get(ctx)
        val meta = config.meta
        if (meta.revision != s.serverConfigRevision) {
            body.put("config", KioskConfig.redacted(config.config.toJson()))
                .put("configRevision", meta.revision)
                .put("configSource", meta.source ?: JSONObject.NULL)
        }
        return try {
            val (status, json) = post("$url/v1/device/checkin", body, token)
            when (status) {
                200 -> {
                    store.checkinOk(
                        name = json.optString("name").ifBlank { null },
                        intervalSec = json.optInt("checkinIntervalSec", 60),
                        appsHash = json.optString("appsHash").takeIf { !json.isNull("appsHash") && it.isNotBlank() },
                        configRevision = if (json.isNull("configRevision")) null else json.optInt("configRevision"),
                    )
                    Result.Ok("ok")
                }
                401 -> {
                    store.removedByPanel()
                    Log.w(TAG, "O painel não reconhece mais este aparelho (removido)")
                    Result.Failed("removido do painel: cadastre de novo")
                }
                else -> {
                    store.checkinFailed("HTTP $status")
                    Result.Failed("o painel respondeu HTTP $status")
                }
            }
        } catch (e: Exception) {
            store.checkinFailed(e.message ?: e.javaClass.simpleName)
            Result.Failed("sem conexão com o painel: ${e.message}")
        }
    }

    private fun post(url: String, body: JSONObject, token: String?): Pair<Int, JSONObject> {
        val conn = URL(url).openConnection() as HttpURLConnection
        try {
            conn.requestMethod = "POST"
            conn.connectTimeout = 15_000
            conn.readTimeout = 20_000
            conn.doOutput = true
            conn.setRequestProperty("Content-Type", "application/json")
            conn.setRequestProperty("User-Agent", "StarXKiosk/${BuildConfig.VERSION_NAME}")
            if (token != null) conn.setRequestProperty("Authorization", "Bearer $token")
            conn.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            val status = conn.responseCode
            val stream = if (status in 200..299) conn.inputStream else conn.errorStream
            val text = stream?.use { it.readBytes().toString(Charsets.UTF_8) }.orEmpty()
            val json = runCatching { JSONObject(text) }.getOrDefault(JSONObject())
            return status to json
        } finally {
            conn.disconnect()
        }
    }

    companion object {
        private const val TAG = "Panel"

        fun sha256(s: String): String =
            MessageDigest.getInstance("SHA-256").digest(s.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
    }
}
