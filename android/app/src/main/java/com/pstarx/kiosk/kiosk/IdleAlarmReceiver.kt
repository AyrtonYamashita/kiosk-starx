package com.pstarx.kiosk.kiosk

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log

/**
 * Alarme da saída por inatividade com a tela apagada: o colaborador apagou a tela no meio do SSW e não voltou. Com a
 * tela apagada a tela do kiosk fica pausada (sem o contador de cada segundo); o alarme acorda o aparelho no prazo e a
 * tela do kiosk desconecta (apaga a sessão e volta ao início).
 */
class IdleAlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ACTION) return
        Log.i(TAG, "Prazo de inatividade com a tela apagada")
        val pending = goAsync()
        Handler(Looper.getMainLooper()).post {
            try {
                onFire?.invoke()
            } finally {
                pending.finish()
            }
        }
    }

    companion object {
        private const val TAG = "IdleAlarm"
        private const val ACTION = "com.pstarx.kiosk.IDLE_LOGOUT"

        /** A tela do kiosk aberta (na thread principal): confere o prazo e desconecta. */
        @Volatile var onFire: (() -> Unit)? = null

        private fun intent(ctx: Context): PendingIntent = PendingIntent.getBroadcast(
            ctx.applicationContext,
            0,
            Intent(ACTION).setClass(ctx.applicationContext, IdleAlarmReceiver::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        /** Agenda para `atElapsed` (SystemClock.elapsedRealtime, que conta também o sono do aparelho). */
        fun schedule(ctx: Context, atElapsed: Long) {
            val am = ctx.getSystemService(AlarmManager::class.java) ?: return
            val pi = intent(ctx)
            // exato quando o Android deixa (até o 11 sempre); senão o "inexato" (pode atrasar uns minutos no sono
            // profundo: ao acender a tela, quem já passou do prazo sai na hora de qualquer jeito)
            val exact = Build.VERSION.SDK_INT < 31 || am.canScheduleExactAlarms()
            runCatching {
                if (exact) am.setExactAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, atElapsed, pi)
                else am.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, atElapsed, pi)
            }.onFailure { Log.w(TAG, "Alarme não agendado: ${it.message}") }
        }

        fun cancel(ctx: Context) {
            ctx.getSystemService(AlarmManager::class.java)?.cancel(intent(ctx))
        }
    }
}
