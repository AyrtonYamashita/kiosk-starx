package com.pstarx.kiosk.panel

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.SystemClock
import android.util.Log
import java.util.concurrent.Executors

/**
 * Agenda os check-ins: alarme a cada `intervalSec` (inexato, permitido em Doze) e um check-in imediato quando algo
 * muda (boot, configuração salva, cadastro). Cadastro pendente (QR sem rede) é tentado a cada ciclo.
 */
object PanelSync {
    private const val TAG = "PanelSync"
    private val executor = Executors.newSingleThreadExecutor()

    /** Check-in agora (em segundo plano) e reagenda o próximo. */
    fun now(context: Context, reason: String) {
        val ctx = context.applicationContext
        executor.execute { runCycle(ctx, reason) }
    }

    /** Um ciclo, bloqueante (usado pelo alarme com goAsync). */
    fun runCycle(ctx: Context, reason: String) {
        val store = PanelStore.get(ctx)
        try {
            val s = store.state
            val client = PanelClient(ctx)
            when {
                s.pendingUrl != null && s.pendingCode != null && !s.enrolled -> {
                    // garante a permissão do serial antes de cadastrar (o painel reconhece o aparelho pelo serial)
                    com.pstarx.kiosk.admin.DeviceOwner.grantSelfPermissions(ctx)
                    val r = client.enroll(s.pendingUrl, s.pendingCode)
                    Log.i(TAG, "Cadastro pendente ($reason): $r")
                    // código recusado: não adianta insistir
                    if (r is PanelClient.Result.Ok || (r is PanelClient.Result.Failed && !r.message.startsWith("sem conexão"))) store.clearPending()
                    if (r is PanelClient.Result.Failed) store.checkinFailed("cadastro: ${r.message}")
                }
                s.enrolled -> client.checkin().also { if (it is PanelClient.Result.Failed) Log.w(TAG, "Check-in ($reason): ${it.message}") }
                else -> Unit
            }
        } catch (e: Exception) {
            Log.e(TAG, "Falha no ciclo ($reason)", e)
        } finally {
            schedule(ctx)
        }
    }

    fun schedule(ctx: Context) {
        val s = PanelStore.get(ctx).state
        val am = ctx.getSystemService(AlarmManager::class.java)
        val pi = PendingIntent.getBroadcast(ctx, 1, Intent(ctx, Alarm::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        if (!s.enrolled && s.pendingCode == null) {
            am.cancel(pi)
            return
        }
        // sem cadastro ainda (QR sem rede): tenta a cada 30 s
        val delayMs = if (s.enrolled) s.intervalSec * 1000L else 30_000L
        am.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, SystemClock.elapsedRealtime() + delayMs, pi)
    }

    class Alarm : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            val pending = goAsync()
            executor.execute {
                try {
                    runCycle(context.applicationContext, "alarm")
                } finally {
                    pending.finish()
                }
            }
        }
    }
}
