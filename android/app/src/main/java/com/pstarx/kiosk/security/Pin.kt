package com.pstarx.kiosk.security

import com.pstarx.kiosk.config.KioskConfig.PinHash
import java.nio.ByteBuffer
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * PIN de administrador. A configuração guarda só o hash: PBKDF2-HMAC-SHA256(utf8(pin), salt, iterações), 32 bytes.
 * Implementado sobre HmacSHA256 para dar o mesmo resultado em qualquer JVM/Node (o painel vai gerar hashes também).
 */
object Pin {
    const val ALGO = "pbkdf2-sha256"
    const val ITERATIONS = 100_000

    /** 4 a 32 caracteres. Só dígitos = teclado numérico na hora de digitar. */
    fun validate(pin: String): String? = when {
        pin.length < 4 -> "O PIN precisa ter pelo menos 4 caracteres"
        pin.length > 32 -> "O PIN pode ter no máximo 32 caracteres"
        pin.any { it.isWhitespace() || it.isISOControl() } -> "O PIN não pode ter espaços"
        else -> null
    }

    /** Lento de propósito: chame fora da thread principal. */
    fun hash(pin: String, iterations: Int = ITERATIONS): PinHash {
        validate(pin)?.let { throw IllegalArgumentException(it) }
        val salt = ByteArray(16).also { SecureRandom().nextBytes(it) }
        val h = pbkdf2Sha256(pin.toByteArray(Charsets.UTF_8), salt, iterations)
        val b64 = Base64.getEncoder()
        return PinHash(ALGO, iterations, b64.encodeToString(salt), b64.encodeToString(h), numeric = pin.all { it.isDigit() })
    }

    /** Lento de propósito: chame fora da thread principal. */
    fun verify(pin: String, pinHash: PinHash?): Boolean {
        if (pinHash == null || pinHash.algo != ALGO || pin.isEmpty() || pin.length > 32) return false
        if (pinHash.iterations !in 1_000..1_000_000) return false
        val salt = runCatching { Base64.getDecoder().decode(pinHash.salt) }.getOrNull() ?: return false
        val expected = runCatching { Base64.getDecoder().decode(pinHash.hash) }.getOrNull() ?: return false
        if (expected.size != 32) return false
        return MessageDigest.isEqual(pbkdf2Sha256(pin.toByteArray(Charsets.UTF_8), salt, pinHash.iterations), expected)
    }

    /** PBKDF2 (RFC 8018) com HMAC-SHA256, um bloco de 32 bytes. */
    fun pbkdf2Sha256(password: ByteArray, salt: ByteArray, iterations: Int): ByteArray {
        val mac = Mac.getInstance("HmacSHA256").apply { init(SecretKeySpec(password, "HmacSHA256")) }
        mac.update(salt)
        mac.update(ByteBuffer.allocate(4).putInt(1).array())
        var u = mac.doFinal()
        val result = u.copyOf()
        repeat(iterations - 1) {
            u = mac.doFinal(u)
            for (i in result.indices) result[i] = (result[i].toInt() xor u[i].toInt()).toByte()
        }
        return result
    }
}

/**
 * Bloqueio contra tentativa e erro no PIN: as 4 primeiras falhas são livres; da 5ª em diante cada erro
 * bloqueia por 30 s, dobrando até 15 min. Acertar zera.
 */
data class PinLockout(val failures: Int = 0, val lockedUntilMs: Long = 0) {
    fun isLocked(nowMs: Long) = nowMs < lockedUntilMs
    fun remainingMs(nowMs: Long) = (lockedUntilMs - nowMs).coerceAtLeast(0)

    fun onFailure(nowMs: Long): PinLockout {
        val n = failures + 1
        if (n < FREE_ATTEMPTS) return PinLockout(n, 0)
        val lockMs = (BASE_LOCK_MS shl (n - FREE_ATTEMPTS).coerceAtMost(10)).coerceAtMost(MAX_LOCK_MS)
        return PinLockout(n, nowMs + lockMs)
    }

    fun freeAttemptsLeft() = (FREE_ATTEMPTS - 1 - failures).coerceAtLeast(0)

    fun onSuccess() = PinLockout()

    companion object {
        const val FREE_ATTEMPTS = 5
        const val BASE_LOCK_MS = 30_000L
        const val MAX_LOCK_MS = 15 * 60_000L
    }
}

/** N toques no canto dentro de uma janela de tempo (contada a partir do primeiro toque). */
class TapCounter(private val required: Int, private val windowMs: Long = 2_000) {
    private var count = 0
    private var firstAt = 0L

    /** true quando completa o gesto (e zera a contagem). */
    fun onTap(nowMs: Long): Boolean {
        if (count == 0 || nowMs - firstAt > windowMs) {
            count = 0
            firstAt = nowMs
        }
        count++
        if (count >= required) {
            count = 0
            return true
        }
        return false
    }
}
