package com.pstarx.kiosk.kiosk

import android.app.admin.DevicePolicyManager
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.Log
import com.pstarx.kiosk.admin.AdminReceiver

/**
 * Escurecimento por inatividade (display.dimAfterSec): sem toque por esse tempo, o brilho do sistema cai para 1% —
 * a tela NUNCA apaga, então o app continua com rede e os comandos do painel chegam na hora. O primeiro toque
 * devolve o brilho anterior. Ajuste do sistema (Device Owner): vale também com outro app na frente.
 *
 * Toques chegam da tela do kiosk (KioskActivity) e, com outro app na frente, da área do gesto no canto
 * (CornerOverlay, que recebe ACTION_OUTSIDE de qualquer toque na tela). Só na thread principal.
 */
object ScreenDimmer {
    private const val TAG = "ScreenDimmer"
    /** 1% de 255. */
    private const val DIM_LEVEL = 3
    private val main = Handler(Looper.getMainLooper())
    private var ctx: Context? = null
    private var afterMs = 0L

    /** Brilho escurecido agora (o próximo toque só acorda). */
    @Volatile var dimmed = false
        private set

    private val dimNow = Runnable { dim() }

    /** Configuração aplicada (kiosk ligado ou não). Liga, desliga ou muda o tempo. */
    fun configure(context: Context, dimAfterSec: Int, active: Boolean) {
        ctx = context.applicationContext
        afterMs = if (active) dimAfterSec * 1000L else 0L
        main.removeCallbacks(dimNow)
        if (afterMs <= 0) {
            restore()
            return
        }
        if (!dimmed) main.postDelayed(dimNow, afterMs)
    }

    /** Toque do usuário (ou mensagem do painel). true = estava escuro (o toque só acordou a tela). */
    fun onUserActivity(): Boolean {
        val wasDimmed = dimmed
        if (wasDimmed) restore()
        if (afterMs > 0) {
            main.removeCallbacks(dimNow)
            main.postDelayed(dimNow, afterMs)
        }
        return wasDimmed
    }

    private fun dim() {
        val c = ctx ?: return
        if (dimmed || afterMs <= 0) return
        // durante a administração (PIN / configurações) não escurece: tenta de novo depois
        if (KioskController.get(c).adminSessionActive) {
            main.postDelayed(dimNow, afterMs)
            return
        }
        val cr = c.contentResolver
        val prefs = c.getSharedPreferences("dimmer", Context.MODE_PRIVATE)
        // guarda o brilho atual só uma vez (se o app morreu escuro, o valor salvo continua sendo o claro)
        if (!prefs.contains("brightness")) {
            prefs.edit()
                .putString("brightness", Settings.System.getString(cr, Settings.System.SCREEN_BRIGHTNESS))
                .putString("mode", Settings.System.getString(cr, Settings.System.SCREEN_BRIGHTNESS_MODE))
                .commit()
        }
        if (set(c, Settings.System.SCREEN_BRIGHTNESS_MODE, Settings.System.SCREEN_BRIGHTNESS_MODE_MANUAL.toString()) &&
            set(c, Settings.System.SCREEN_BRIGHTNESS, DIM_LEVEL.toString())
        ) {
            dimmed = true
            Log.i(TAG, "Sem toque há ${afterMs / 1000} s: brilho em 1%")
        }
    }

    /** Devolve o brilho de antes (também usado na subida do app, se ele morreu com a tela escura). */
    fun restore(context: Context? = ctx) {
        val c = context?.applicationContext ?: return
        ctx = c
        val prefs = c.getSharedPreferences("dimmer", Context.MODE_PRIVATE)
        if (!prefs.contains("brightness")) {
            dimmed = false
            return
        }
        prefs.getString("mode", null)?.let { set(c, Settings.System.SCREEN_BRIGHTNESS_MODE, it) }
        prefs.getString("brightness", null)?.let { set(c, Settings.System.SCREEN_BRIGHTNESS, it) }
        prefs.edit().clear().commit()
        if (dimmed) Log.i(TAG, "Toque: brilho de volta")
        dimmed = false
    }

    private fun set(c: Context, key: String, value: String): Boolean = try {
        c.getSystemService(DevicePolicyManager::class.java).setSystemSetting(AdminReceiver.component(c), key, value)
        true
    } catch (e: Exception) {
        Log.w(TAG, "Não foi possível ajustar $key: ${e.message}")
        false
    }
}
