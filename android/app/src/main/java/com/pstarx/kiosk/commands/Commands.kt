package com.pstarx.kiosk.commands

import android.app.admin.DevicePolicyManager
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.pstarx.kiosk.admin.AdminReceiver
import com.pstarx.kiosk.admin.DeviceOwner
import com.pstarx.kiosk.apps.AppInstaller
import com.pstarx.kiosk.apps.Artifact
import com.pstarx.kiosk.kiosk.KioskController
import com.pstarx.kiosk.panel.PanelClient
import com.pstarx.kiosk.panel.PanelSync
import com.pstarx.kiosk.ui.MessageActivity
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * Comandos do painel. Chegam na resposta do check-in (o painel reenvia até receber o resultado), rodam numa fila
 * própria (uma instalação não atrasa o check-in) e o resultado fica guardado até o painel confirmar (`ackResults`).
 * O id de cada comando executado é lembrado: repetido não roda de novo, só o resultado é reenviado.
 */
object Commands {
    private const val TAG = "Commands"
    private const val MAX_DONE = 200

    /** Fila de trabalho do painel: comandos e instalações de apps gerenciados. */
    val worker: ExecutorService = Executors.newSingleThreadExecutor()
    private val running = mutableSetOf<String>()

    data class Outcome(val ok: Boolean, val message: String, val output: JSONObject? = null)

    private fun prefs(ctx: Context) = ctx.getSharedPreferences("commands", Context.MODE_PRIVATE)

    /** Comandos recebidos no check-in. */
    fun receive(context: Context, commands: JSONArray) {
        val ctx = context.applicationContext
        for (i in 0 until commands.length()) {
            val c = commands.optJSONObject(i) ?: continue
            val id = c.optString("id")
            if (id.isBlank()) continue
            synchronized(this) {
                if (id in running || isDone(ctx, id)) return@synchronized
                running += id
                worker.execute { run(ctx, id, c.optString("type"), c.optJSONObject("payload") ?: JSONObject()) }
            }
        }
    }

    /** Resultados ainda não confirmados pelo painel (vão no check-in). */
    fun pendingResults(ctx: Context): JSONArray {
        val obj = runCatching { JSONObject(prefs(ctx).getString("results", "{}")!!) }.getOrDefault(JSONObject())
        val arr = JSONArray()
        obj.keys().forEach { arr.put(obj.getJSONObject(it)) }
        return arr
    }

    /**
     * O painel gravou os resultados enviados (`sent`) cujos ids estão em `ids`. Só sai o que não mudou desde o envio
     * (ex.: "lida" registrado enquanto "exibida" estava a caminho continua na fila).
     */
    @Synchronized
    fun ack(ctx: Context, ids: JSONArray, sent: JSONArray) {
        if (ids.length() == 0) return
        val acked = (0 until ids.length()).map { ids.optString(it) }.toSet()
        val sentById = (0 until sent.length()).mapNotNull { sent.optJSONObject(it) }.associateBy { it.optString("id") }
        val obj = runCatching { JSONObject(prefs(ctx).getString("results", "{}")!!) }.getOrDefault(JSONObject())
        for (id in acked) {
            if (obj.optJSONObject(id)?.toString() == sentById[id]?.toString()) obj.remove(id)
        }
        prefs(ctx).edit().putString("results", obj.toString()).commit()
    }

    /** Guarda (ou substitui) o resultado de um comando e antecipa o check-in. */
    @Synchronized
    fun report(ctx: Context, id: String, outcome: Outcome, checkinNow: Boolean = true) {
        val obj = runCatching { JSONObject(prefs(ctx).getString("results", "{}")!!) }.getOrDefault(JSONObject())
        obj.put(id, JSONObject().put("id", id).put("ok", outcome.ok).put("message", outcome.message).put("output", outcome.output ?: JSONObject.NULL))
        prefs(ctx).edit().putString("results", obj.toString()).commit()
        if (checkinNow) PanelSync.now(ctx, "command")
    }

    private fun isDone(ctx: Context, id: String): Boolean = prefs(ctx).getString("done", "")!!.split(',').contains(id)

    @Synchronized
    private fun markDone(ctx: Context, id: String) {
        val list = prefs(ctx).getString("done", "")!!.split(',').filter { it.isNotBlank() && it != id }.takeLast(MAX_DONE - 1) + id
        prefs(ctx).edit().putString("done", list.joinToString(",")).commit()
    }

    private fun run(ctx: Context, id: String, type: String, p: JSONObject) {
        Log.i(TAG, "Executando $type ($id)")
        // marcado antes de executar: um reboot (ou o app atualizado) não repete o comando depois
        markDone(ctx, id)
        val outcome = try {
            if (!DeviceOwner.isDeviceOwner(ctx)) Outcome(false, "o app não é Device Owner") else execute(ctx, id, type, p)
        } catch (e: Exception) {
            Log.e(TAG, "Falha em $type", e)
            Outcome(false, "${e.javaClass.simpleName}: ${e.message}")
        } finally {
            synchronized(this) { running -= id }
        }
        if (outcome != null) report(ctx, id, outcome)
        Log.i(TAG, "$type ($id): ${outcome?.message ?: "resultado enviado pela própria ação"}")
    }

    /** null: a própria ação já registrou o resultado. */
    private fun execute(ctx: Context, id: String, type: String, p: JSONObject): Outcome? {
        val dpm = ctx.getSystemService(DevicePolicyManager::class.java)
        val admin = AdminReceiver.component(ctx)
        return when (type) {
            "lock" -> {
                dpm.lockNow()
                Outcome(true, "tela bloqueada")
            }
            "reboot" -> {
                // o resultado precisa chegar antes: depois do boot o painel não reenviaria (o comando já está marcado)
                report(ctx, id, Outcome(true, "reiniciando"), checkinNow = false)
                runCatching { PanelClient(ctx).checkin() }
                Thread.sleep(1_000)
                dpm.reboot(admin)
                null
            }
            "message" -> {
                val intent = Intent(ctx, MessageActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_MULTIPLE_TASK)
                    .putExtra(MessageActivity.EXTRA_ID, id)
                    .putExtra(MessageActivity.EXTRA_TITLE, p.optString("title").takeIf { !p.isNull("title") && it.isNotBlank() })
                    .putExtra(MessageActivity.EXTRA_TEXT, p.optString("text"))
                ctx.startActivity(intent)
                // "exibida" vem da própria tela (e depois "lida", com o toque em OK)
                null
            }
            "screenshot" -> ScreenCapture.captureAndUpload(ctx, id)
            "reload" -> {
                Handler(Looper.getMainLooper()).post { KioskController.get(ctx).reload() }
                // carga aberta: a tela só recarrega quando ela terminar (KioskActivity.refresh)
                Outcome(
                    true,
                    when {
                        !KioskController.get(ctx).enforced -> "kiosk desligado: nada a recarregar"
                        com.pstarx.kiosk.ops.OpsReader.isBusy() -> "aguardando a bipagem terminar: recarrega quando a carga fechar"
                        else -> "kiosk recarregado"
                    },
                )
            }
            "install_app" -> {
                val a = Artifact.fromJson(p.getJSONObject("artifact"))
                when (val r = AppInstaller(ctx).install(a)) {
                    is AppInstaller.Result.Ok -> Outcome(true, r.message, JSONObject().put("versionCode", a.versionCode))
                    is AppInstaller.Result.Failed -> Outcome(false, r.message)
                }
            }
            "uninstall_app" -> when (val r = AppInstaller(ctx).uninstall(p.getString("packageName"))) {
                is AppInstaller.Result.Ok -> Outcome(true, r.message)
                is AppInstaller.Result.Failed -> Outcome(false, r.message)
            }
            else -> Outcome(false, "comando \"$type\" não existe nesta versão do app")
        }
    }
}
