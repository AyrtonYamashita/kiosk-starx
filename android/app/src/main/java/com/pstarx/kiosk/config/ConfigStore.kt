package com.pstarx.kiosk.config

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import org.json.JSONObject
import java.io.File
import java.time.Instant

/**
 * Configuração gravada no aparelho (files/config.json), com número de revisão e origem da última alteração
 * (local, adb, import, provisioning; na fase 3, painel). Toda alteração passa por [update].
 */
class ConfigStore private constructor(context: Context) {
    private val file = File(context.applicationContext.filesDir, "config.json")
    private val main = Handler(Looper.getMainLooper())
    private val listeners = mutableSetOf<(KioskConfig) -> Unit>()

    data class Meta(val revision: Int, val updatedAt: String?, val source: String?)

    @Volatile private var cached: Pair<KioskConfig, Meta>? = null

    val config: KioskConfig get() = load().first
    val meta: Meta get() = load().second

    @Synchronized
    private fun load(): Pair<KioskConfig, Meta> {
        cached?.let { return it }
        val loaded = try {
            if (file.isFile) {
                val o = JSONObject(file.readText())
                val parsed = KioskConfig.parse(o.optJSONObject("config") ?: JSONObject())
                parsed.config to Meta(o.optInt("revision", 0), o.optString("updatedAt").ifBlank { null }, o.optString("source").ifBlank { null })
            } else {
                KioskConfig() to Meta(0, null, null)
            }
        } catch (e: Exception) {
            Log.e(TAG, "config.json ilegível: usando o padrão", e)
            KioskConfig() to Meta(0, null, null)
        }
        cached = loaded
        return loaded
    }

    /** Aplica uma alteração (ver [ConfigPatch]). O hash do PIN é lento: não chame na thread principal se houver `pin`. */
    @Synchronized
    fun update(patch: JSONObject, source: String, replace: Boolean = false): ConfigPatch.Result {
        val result = ConfigPatch.apply(config.toJson(), patch, replace)
        val next = result.config ?: return result
        save(next, source)
        return result
    }

    /** Grava uma configuração já montada (tela de configurações). */
    @Synchronized
    fun save(next: KioskConfig, source: String) {
        val meta = Meta(meta.revision + 1, Instant.now().toString(), source)
        val doc = JSONObject()
            .put("revision", meta.revision)
            .put("updatedAt", meta.updatedAt)
            .put("source", source)
            .put("config", next.toJson())
        val tmp = File(file.parentFile, "config.json.tmp")
        tmp.writeText(doc.toString(2))
        if (!tmp.renameTo(file)) {
            file.delete()
            if (!tmp.renameTo(file)) throw IllegalStateException("não foi possível gravar config.json")
        }
        cached = next to meta
        Log.i(TAG, "Configuração rev ${meta.revision} gravada ($source)")
        val copy = synchronized(listeners) { listeners.toList() }
        main.post { copy.forEach { it(next) } }
    }

    fun addListener(l: (KioskConfig) -> Unit) = synchronized(listeners) { listeners += l }
    fun removeListener(l: (KioskConfig) -> Unit) = synchronized(listeners) { listeners -= l }

    companion object {
        private const val TAG = "ConfigStore"

        @Volatile private var instance: ConfigStore? = null

        fun get(context: Context): ConfigStore =
            instance ?: synchronized(this) { instance ?: ConfigStore(context).also { instance = it } }
    }
}
