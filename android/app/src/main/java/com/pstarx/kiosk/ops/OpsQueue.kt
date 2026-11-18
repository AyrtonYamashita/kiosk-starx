package com.pstarx.kiosk.ops

import org.json.JSONObject
import java.io.File

/**
 * Fila de eventos no disco (um JSON por linha): nada se perde sem rede ou se o app reiniciar.
 * Acrescenta no fim (barato a cada bipagem) e reescreve só quando o servidor confirma um lote.
 * Sinais de vida não passam por aqui (só o mais recente importa; fica na memória do envio).
 * Sem Android: testável na JVM. Thread-safe.
 */
class OpsQueue(private val file: File, private val max: Int = MAX_EVENTS) {
    private val items = ArrayList<JSONObject>()
    private var dropped = 0

    init {
        file.parentFile?.mkdirs()
        if (file.exists()) {
            file.forEachLine { line -> if (line.isNotBlank()) runCatching { JSONObject(line) }.getOrNull()?.takeIf { it.has("id") }?.let { items += it } }
            if (items.size > max) {
                dropped += items.size - max
                items.subList(0, items.size - max).clear()
                rewrite()
            }
        }
    }

    @Synchronized
    fun add(events: List<JSONObject>) {
        if (events.isEmpty()) return
        items += events
        if (items.size > max) {
            // muito tempo sem rede: descarta os mais antigos (o resumo da carga se refaz com os seguintes)
            dropped += items.size - max
            items.subList(0, items.size - max).clear()
            rewrite()
        } else {
            file.appendText(events.joinToString("") { it.toString() + "\n" })
        }
    }

    /** Os primeiros `n` eventos (cópia). */
    @Synchronized
    fun peek(n: Int): List<JSONObject> = items.take(n).map { JSONObject(it.toString()) }

    /** Tira da fila os eventos aceitos pelo servidor. */
    @Synchronized
    fun remove(ids: Collection<String>) {
        if (ids.isEmpty()) return
        val set = ids.toHashSet()
        if (items.removeAll { it.optString("id") in set }) rewrite()
    }

    @Synchronized
    fun clear() {
        items.clear()
        file.delete()
    }

    @get:Synchronized
    val size: Int get() = items.size

    /** Eventos descartados por excesso desde que o app abriu (vai no log). */
    @get:Synchronized
    val droppedCount: Int get() = dropped

    private fun rewrite() {
        val tmp = File(file.parentFile, file.name + ".tmp")
        tmp.writeText(items.joinToString("") { it.toString() + "\n" })
        if (!tmp.renameTo(file)) {
            file.delete()
            tmp.renameTo(file)
        }
    }

    companion object {
        const val MAX_EVENTS = 5_000
    }
}
