package com.pstarx.kiosk.security

import android.content.Context
import com.pstarx.kiosk.config.ConfigStore

/** Conferência do PIN com bloqueio progressivo, compartilhada pela tela de PIN e pelo ADB. */
class PinGate(context: Context) {
    private val ctx = context.applicationContext
    private val prefs = ctx.getSharedPreferences("pin_lockout", Context.MODE_PRIVATE)

    sealed interface Result {
        data object Ok : Result
        data object NoPin : Result
        data class Wrong(val freeAttemptsLeft: Int, val lockedForMs: Long) : Result
        data class Locked(val remainingMs: Long) : Result
    }

    private var lockout: PinLockout
        get() = PinLockout(prefs.getInt("failures", 0), prefs.getLong("locked_until", 0))
        set(v) {
            prefs.edit().putInt("failures", v.failures).putLong("locked_until", v.lockedUntilMs).apply()
        }

    fun lockedForMs(): Long = lockout.remainingMs(System.currentTimeMillis())

    /** Lento (PBKDF2): fora da thread principal. */
    fun check(pin: String?): Result {
        val hash = ConfigStore.get(ctx).config.security.pinHash ?: return Result.NoPin
        val now = System.currentTimeMillis()
        val current = lockout
        if (current.isLocked(now)) return Result.Locked(current.remainingMs(now))
        if (!pin.isNullOrEmpty() && Pin.verify(pin, hash)) {
            lockout = current.onSuccess()
            return Result.Ok
        }
        val next = current.onFailure(now)
        lockout = next
        return Result.Wrong(next.freeAttemptsLeft(), next.remainingMs(now))
    }
}
