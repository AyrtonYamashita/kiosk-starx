package com.pstarx.kiosk.kiosk

import android.content.Context
import org.json.JSONObject
import java.security.MessageDigest

/**
 * Aviso de privacidade (LGPD) do coletor (display.privacyNotice). Aparece uma vez por aparelho e de novo quando o
 * texto muda (a versão é o SHA-256 do texto). Ao tocar em "Entendi", grava a versão aceita e deixa uma ciência
 * pendente, que o check-in manda ao painel até ele confirmar (privacyAcked).
 */
object PrivacyNotice {
    private const val PREFS = "privacy_notice"
    private const val ACCEPTED = "accepted_hash"
    private const val PENDING = "pending_ack"

    fun hash(text: String): String =
        MessageDigest.getInstance("SHA-256").digest(text.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }

    /** O aviso precisa aparecer? (texto definido e ainda não aceito nesta versão) */
    fun needsShowing(ctx: Context, text: String): Boolean =
        text.isNotBlank() && prefs(ctx).getString(ACCEPTED, null) != hash(text)

    /** "Entendi": grava a versão aceita e a ciência a enviar. */
    fun accept(ctx: Context, text: String, nowMs: Long = System.currentTimeMillis()) {
        val h = hash(text)
        val ack = JSONObject().put("hash", h).put("at", nowMs)
        prefs(ctx).edit().putString(ACCEPTED, h).putString(PENDING, ack.toString()).apply()
    }

    /** Ciência ainda não confirmada pelo painel (vai no check-in), ou null. */
    fun pending(ctx: Context): JSONObject? =
        prefs(ctx).getString(PENDING, null)?.let { runCatching { JSONObject(it) }.getOrNull() }

    /** O painel confirmou a ciência com este hash: não precisa mais enviar. */
    fun confirmed(ctx: Context, hash: String?) {
        if (hash.isNullOrBlank()) return
        val p = pending(ctx) ?: return
        if (p.optString("hash") == hash) prefs(ctx).edit().remove(PENDING).apply()
    }

    private fun prefs(ctx: Context) = ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
}
