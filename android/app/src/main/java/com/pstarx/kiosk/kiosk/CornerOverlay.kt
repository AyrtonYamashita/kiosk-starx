package com.pstarx.kiosk.kiosk

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.graphics.PixelFormat
import android.os.SystemClock
import android.provider.Settings
import android.util.Log
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import com.pstarx.kiosk.config.KioskConfig
import com.pstarx.kiosk.security.TapCounter
import com.pstarx.kiosk.ui.PinActivity

/**
 * Área invisível no canto da tela, por cima de qualquer app, que conta toques para abrir a administração.
 * Necessária no modo app único e na grade (quando um app da grade está aberto, a tela do kiosk fica por baixo).
 *
 * Exige a permissão "Sobrepor a outros apps" (o Device Owner não consegue conceder sozinho). Conceder uma vez:
 * nas configurações do kiosk (Avançado) ou por ADB: `adb shell appops set com.pstarx.kiosk SYSTEM_ALERT_WINDOW allow`.
 * Sem a permissão, a administração continua acessível pela tela do kiosk (quando o app fecha, ou pelo Home na grade).
 */
object CornerOverlay {
    private const val TAG = "CornerOverlay"
    private var view: View? = null
    private var shownFor: String? = null

    fun canShow(context: Context) = Settings.canDrawOverlays(context)

    /** Chamar na thread principal. Mostra, move ou esconde conforme o estado do kiosk. */
    fun update(context: Context) {
        val ctx = context.applicationContext
        val kiosk = KioskController.get(ctx)
        val c = kiosk.config
        val wanted = kiosk.enforced && c.kiosk.enabled && c.kiosk.mode != KioskConfig.Mode.WEB && canShow(ctx)
        val key = "${c.security.exitCorner}:${c.security.exitTaps}"
        if (!wanted) {
            hide(ctx)
            return
        }
        if (view != null && shownFor == key) return
        hide(ctx)
        show(ctx, c.security.exitCorner, c.security.exitTaps)
        shownFor = key
    }

    @SuppressLint("ClickableViewAccessibility")
    private fun show(ctx: Context, corner: KioskConfig.Corner, taps: Int) {
        val wm = ctx.getSystemService(WindowManager::class.java)
        val size = (56 * ctx.resources.displayMetrics.density).toInt()
        val counter = TapCounter(taps)
        val v = View(ctx).apply {
            setOnTouchListener { _, ev ->
                if (ev.actionMasked == MotionEvent.ACTION_DOWN && counter.onTap(SystemClock.uptimeMillis())) {
                    PinActivity.open(ctx)
                }
                true
            }
        }
        val lp = WindowManager.LayoutParams(
            size,
            size,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
                WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = when (corner) {
                KioskConfig.Corner.TOP_LEFT -> Gravity.TOP or Gravity.START
                KioskConfig.Corner.TOP_RIGHT -> Gravity.TOP or Gravity.END
                KioskConfig.Corner.BOTTOM_LEFT -> Gravity.BOTTOM or Gravity.START
                KioskConfig.Corner.BOTTOM_RIGHT -> Gravity.BOTTOM or Gravity.END
            }
        }
        try {
            wm.addView(v, lp)
            view = v
        } catch (e: Exception) {
            Log.w(TAG, "Não foi possível mostrar a área de toque: ${e.message}")
        }
    }

    private fun hide(ctx: Context) {
        val v = view ?: return
        runCatching { ctx.getSystemService(WindowManager::class.java).removeView(v) }
        view = null
        shownFor = null
    }

    /** Intent da tela do Android para conceder a permissão. */
    fun permissionIntent(ctx: Context): Intent =
        Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, android.net.Uri.parse("package:${ctx.packageName}"))
}
