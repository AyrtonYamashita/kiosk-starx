package com.pstarx.kiosk.adb

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.util.Log
import com.pstarx.kiosk.config.ConfigStore
import com.pstarx.kiosk.config.KioskConfig
import com.pstarx.kiosk.device.DeviceInfo
import com.pstarx.kiosk.kiosk.KioskController
import com.pstarx.kiosk.panel.PanelClient
import com.pstarx.kiosk.panel.PanelStore
import com.pstarx.kiosk.panel.PanelSync
import com.pstarx.kiosk.security.Pin
import com.pstarx.kiosk.security.PinGate
import org.json.JSONArray
import org.json.JSONObject
import kotlin.concurrent.thread

/**
 * Configuração por ADB. Só o shell do ADB (ou o sistema) consegue chamar: o receiver exige android.permission.DUMP.
 *
 *   adb shell am broadcast -n com.pstarx.kiosk/.adb.AdbConfigReceiver -a com.pstarx.kiosk.CONFIG \
 *       --es pin 1234 [--es config '<json>' | --es config_b64 <base64>] [--ez replace true] [--ez dump true] [--ez info true]
 *
 *  - `pin`: obrigatório. Com PIN definido, precisa conferir. Sem PIN, vira o PIN do aparelho.
 *  - `config`: alteração parcial (mesclada) ou, com `replace`, a configuração inteira.
 *  - `dump`: devolve a configuração atual (sem o hash do PIN). `info`: devolve as informações do aparelho.
 * A resposta (JSON) aparece na saída do `am broadcast`, em `data=`.
 */
class AdbConfigReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != "${context.packageName}.CONFIG") return
        val pending = goAsync()
        val extras = intent.extras ?: Bundle()
        thread {
            val response = try {
                handle(context.applicationContext, extras)
            } catch (e: Exception) {
                Log.e(TAG, "Falha", e)
                error(e.message ?: e.javaClass.simpleName)
            }
            pending.resultCode = if (response.optBoolean("ok")) 0 else 1
            pending.resultData = response.toString()
            pending.finish()
        }
    }

    private fun handle(ctx: Context, extras: Bundle): JSONObject {
        val store = ConfigStore.get(ctx)
        val pin = extras.getString("pin")
        val hasPin = store.config.security.pinHash != null
        if (hasPin) {
            when (val r = PinGate(ctx).check(pin)) {
                PinGate.Result.Ok, PinGate.Result.NoPin -> Unit
                is PinGate.Result.Locked -> return error("PIN bloqueado por ${r.remainingMs / 1000} s")
                is PinGate.Result.Wrong -> return error("PIN incorreto")
            }
        } else {
            if (pin == null) return error("o aparelho ainda não tem PIN: passe --es pin <novo PIN>")
            Pin.validate(pin)?.let { return error("pin: $it") }
        }

        if (extras.getBoolean("dump", false)) {
            return ok().put("revision", store.meta.revision).put("config", KioskConfig.redacted(store.config.toJson())).put("panel", panelStatus(ctx))
        }
        // painel: cadastrar com o código (aparelho que já tem o app)
        val enrollUrl = extras.getString("enroll_url")
        val enrollCode = extras.getString("enroll_code")
        if (enrollUrl != null || enrollCode != null) {
            if (enrollUrl.isNullOrBlank() || enrollCode.isNullOrBlank()) return error("passe --es enroll_url <endereço> e --es enroll_code <código>")
            return when (val r = PanelClient(ctx).enroll(enrollUrl, enrollCode)) {
                is PanelClient.Result.Ok -> ok().put("message", r.message).put("panel", panelStatus(ctx))
                is PanelClient.Result.Failed -> error(r.message)
            }.also { PanelSync.schedule(ctx) }
        }
        if (extras.getBoolean("checkin", false)) {
            return when (val r = PanelClient(ctx).checkin()) {
                is PanelClient.Result.Ok -> ok().put("panel", panelStatus(ctx))
                is PanelClient.Result.Failed -> error(r.message)
            }
        }
        if (extras.getBoolean("info", false)) {
            return ok().put("info", DeviceInfo(ctx).collect(includeApps = extras.getBoolean("apps", false)))
        }

        val raw = extras.getString("config")
            ?: extras.getString("config_b64")?.let { String(Base64.decode(it, Base64.DEFAULT), Charsets.UTF_8) }
        val patch = when {
            raw != null -> runCatching { JSONObject(raw) }.getOrElse { return error("config não é um JSON válido: ${it.message}") }
            !hasPin -> JSONObject() // só definir o PIN
            else -> return error("nada a fazer: passe --es config '<json>', --ez dump true, --ez info true, --ez checkin true ou --es enroll_url/--es enroll_code")
        }
        // aparelho sem PIN: o PIN do comando vira o PIN (a não ser que a configuração traga outro)
        if (!hasPin) {
            val sec = patch.optJSONObject("security") ?: JSONObject().also { patch.put("security", it) }
            if (!sec.has("pin") && (!sec.has("pinHash") || sec.isNull("pinHash"))) sec.put("pin", pin)
        }
        val result = store.update(patch, source = "adb", replace = extras.getBoolean("replace", false))
        if (!result.ok) return error(result.error ?: "configuração recusada")
        Handler(Looper.getMainLooper()).post { KioskController.get(ctx).apply("config") }
        return ok().put("revision", store.meta.revision).put("warnings", JSONArray(result.warnings))
    }

    private fun panelStatus(ctx: Context): JSONObject {
        val s = PanelStore.get(ctx).state
        return JSONObject()
            .put("serverUrl", s.serverUrl ?: JSONObject.NULL)
            .put("enrolled", s.enrolled)
            .put("name", s.name ?: JSONObject.NULL)
            .put("lastOkAt", if (s.lastOkAt > 0) java.time.Instant.ofEpochMilli(s.lastOkAt).toString() else JSONObject.NULL)
            .put("lastError", s.lastError ?: JSONObject.NULL)
            .put("removed", s.removed)
            .put("pending", s.pendingCode != null)
    }

    private fun ok() = JSONObject().put("ok", true)

    private fun error(msg: String) = JSONObject().put("ok", false).put("error", msg)

    private companion object {
        const val TAG = "AdbConfig"
    }
}
