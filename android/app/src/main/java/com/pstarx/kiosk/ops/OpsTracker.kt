package com.pstarx.kiosk.ops

import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

/** Volumes, peso (kg) e valor (R$). */
data class Totals(val qty: Double, val kg: Double, val value: Double) {
    fun toJson(): JSONObject = JSONObject().put("qty", qty).put("kg", kg).put("value", value)

    companion object {
        /** Campo que a página não conseguiu ler vira 0 (o servidor exige os três números). */
        fun parse(o: JSONObject?): Totals? {
            if (o == null) return null
            fun n(k: String) = o.optDouble(k, 0.0).takeIf { it.isFinite() && it >= 0 } ?: 0.0
            if (o.isNull("qty")) return null
            return Totals(n("qty"), n("kg"), n("value"))
        }
    }
}

/** Retrato da tela do SSW mandado pelo leitor (ssw_reader.js). */
data class Snapshot(
    val screen: String,
    val user: String? = null,
    val domain: String? = null,
    val branch: String? = null,
    val fn: String? = null,
    val plate: String? = null,
    val realPlate: String? = null,
    val units: List<String> = emptyList(),
    val total: Totals? = null,
    val read: Totals? = null,
    /** Estrutura da página quando o leitor não a entendeu (repassada como veio; ver ssw_reader.js). */
    val diag: JSONObject? = null,
    /**
     * Campos extras do leitor (ex.: código de barras), repassados como vieram nos eventos da carga. Quem os entende é o
     * servidor: campos novos saem com a API, sem app novo.
     */
    val extra: JSONObject? = null,
) {
    companion object {
        val SCREENS = setOf("bipagem", "placa", "menu", "login", "outra")
        const val MAX_EXTRA = 4_000
        /** Nome da função (manifesto, carga_manifesto...): quem confere a lista é o servidor (o leitor vem dele). */
        private val FUNCTION = Regex("^[a-z_]{1,30}$")

        /** null se o JSON não fizer sentido (a página mandou lixo). Textos cortados nos limites do servidor. */
        fun parse(json: String): Snapshot? {
            val o = runCatching { JSONObject(json) }.getOrNull() ?: return null
            fun str(k: String, max: Int) = if (o.isNull(k)) null else o.optString(k).trim().take(max).ifBlank { null }
            val units = o.optJSONArray("units")?.let { a -> (0 until a.length()).mapNotNull { a.optString(it).trim().take(10).ifBlank { null } } }.orEmpty()
            return Snapshot(
                screen = o.optString("screen").takeIf { it in SCREENS } ?: "outra",
                user = str("user", 64),
                domain = str("domain", 20),
                branch = str("branch", 20),
                fn = str("fn", 30)?.lowercase()?.takeIf { FUNCTION.matches(it) },
                plate = str("plate", 20),
                realPlate = str("realPlate", 20),
                units = units.take(20),
                total = Totals.parse(o.optJSONObject("total")),
                read = Totals.parse(o.optJSONObject("read")),
                diag = o.optJSONObject("diag")?.takeIf { it.optString("reason").isNotBlank() && it.optString("path").isNotBlank() },
                extra = o.optJSONObject("extra")?.takeIf { it.length() > 0 && it.toString().length <= MAX_EXTRA },
            )
        }
    }
}

/**
 * Transforma os retratos da tela em eventos (formato de docs/operacoes.md). Sem Android: testável na JVM.
 * Todas as horas já vêm corrigidas pela hora do servidor. Não é thread-safe: usar de uma thread só.
 *
 * Regras:
 *  - a leitura começa quando aparece um usuário logado (fora da tela de login); a tela de login = saiu (session null);
 *  - bipagem aberta → op_start; "Lidos" mudou → progress (uma bipagem);
 *  - Concluir/Interromper → só encerra quando a página sai da bipagem em até 10 s (confirmação cancelada não fecha);
 *  - saiu da bipagem sem Concluir/Interromper: se não voltar à mesma placa em 2 min, op_end "left";
 *  - sinal de vida a cada 15 s e logo que a tela muda.
 */
class OpsTracker(private val newId: () -> String = { UUID.randomUUID().toString() }) {
    private class Op(val fn: String, val plate: String, var total: Totals, var read: Totals?, var extra: String?)
    private class PendingEnd(val reason: String, val deadline: Long)

    private var user: String? = null
    private var domain: String? = null
    private var branch: String? = null
    private var screen = "outra"
    private var op: Op? = null
    private var pendingEnd: PendingEnd? = null
    private var awaySince: Long? = null
    private var lastHeartbeat = 0L
    private var lastBipagemAt = Long.MIN_VALUE / 2
    private var lastDiagKey: String? = null
    private var lastDiagAt = 0L

    val currentUser get() = user
    val hasOpenOperation get() = op != null

    /**
     * Alguém bipando: na tela de bipagem (ou com a carga aberta) e a tela mudou há menos de 15 min. O app adia a
     * própria atualização enquanto isso (a instalação reinicia o app e tiraria o colaborador da bipagem).
     */
    fun busy(now: Long) = (screen == "bipagem" || op != null) && now - lastBipagemAt < BUSY_IDLE_MS

    fun onSnapshot(now: Long, s: Snapshot): List<JSONObject> {
        val out = mutableListOf<JSONObject>()
        val screenChanged = s.screen != screen
        screen = s.screen
        if (s.screen == "bipagem") lastBipagemAt = now

        // tela que o leitor não entendeu: a estrutura vai ao servidor (uma vez por tela a cada 10 min)
        s.diag?.let { d ->
            val key = d.optString("reason") + "|" + d.optString("path")
            if (key != lastDiagKey || now - lastDiagAt >= DIAG_REPEAT_MS) {
                val e = event(now, "diag").put("screen", s.screen)
                for (k in DIAG_FIELDS) if (d.has(k) && !d.isNull(k)) e.put(k, d.get(k))
                out += e
                lastDiagKey = key
                lastDiagAt = now
            }
        }

        // sessão: tela de login = ninguém; tela sem o nome do usuário mantém o último conhecido
        val newUser = if (s.screen == "login") null else s.user ?: user
        val newDomain = if (newUser == null) null else s.domain ?: domain.takeIf { newUser == user }
        val newBranch = if (newUser == null) null else s.branch ?: branch.takeIf { newUser == user }
        if (newUser != user || newDomain != domain || newBranch != branch) {
            // Concluir/Interromper seguido de sair do SSW: o fim confirmado vem antes da saída
            val cur = op
            val pe = pendingEnd
            if (newUser == null && cur != null && pe != null) out += opEnd(now, cur, pe.reason)
            if (newUser != null || user != null) {
                out += event(now, "session").put("user", newUser ?: JSONObject.NULL)
                    .put("domain", newDomain ?: JSONObject.NULL).put("branch", newBranch ?: JSONObject.NULL)
            }
            if (newUser == null) {
                // o servidor encerra a descarga aberta ("left") ao receber session null
                op = null
                pendingEnd = null
                awaySince = null
            }
            user = newUser
            domain = newDomain
            branch = newBranch
        }

        if (user != null) {
            val cur = op
            val fn = s.fn
            val plate = s.plate
            if (s.screen == "bipagem" && fn != null && plate != null && s.total != null) {
                if (cur != null && cur.fn == fn && cur.plate == plate) {
                    awaySince = null
                    val read = s.read
                    val extra = s.extra?.toString()
                    // bipagem: "Lidos" mudou ou o leitor tem algo novo (ex.: código de barras que não contou)
                    if (read != null && (read != cur.read || extra != cur.extra)) {
                        val e = event(now, "progress").put("fn", fn).put("plate", plate).put("read", read.toJson())
                        if (s.total != cur.total) e.put("total", s.total.toJson())
                        if (extra != null && extra != cur.extra) e.put("extra", s.extra)
                        out += e
                        cur.read = read
                        cur.total = s.total
                        cur.extra = extra
                    }
                } else {
                    // outra carga: a anterior termina (Concluir/Interromper confirmado) ou o servidor a encerra como "trocada"
                    val pe = pendingEnd
                    if (cur != null && pe != null) out += opEnd(now, cur, pe.reason)
                    val e = event(now, "op_start").put("fn", fn).put("plate", plate).put("total", s.total.toJson())
                    s.realPlate?.let { e.put("realPlate", it) }
                    if (s.units.isNotEmpty()) e.put("units", JSONArray(s.units))
                    s.read?.let { e.put("read", it.toJson()) }
                    s.extra?.let { e.put("extra", it) }
                    out += e
                    op = Op(fn, plate, s.total, s.read, s.extra?.toString())
                    pendingEnd = null
                    awaySince = null
                }
            } else if (cur != null) {
                val pe = pendingEnd
                if (pe != null) {
                    out += opEnd(now, cur, pe.reason)
                    op = null
                    pendingEnd = null
                    awaySince = null
                } else if (awaySince == null) {
                    awaySince = now
                }
            }
        }

        if (screenChanged) out += heartbeat(now)
        return out
    }

    /** Toque em Concluir ou Interromper na bipagem. */
    fun onAction(now: Long, name: String) {
        if (op == null || screen != "bipagem") return
        val reason = when (name) {
            "concluir" -> "concluded"
            "interromper" -> "interrupted"
            else -> return
        }
        pendingEnd = PendingEnd(reason, now + END_CONFIRM_MS)
    }

    /** Chamado a cada segundo: prazos (confirmação, ausência) e sinal de vida. */
    fun tick(now: Long): List<JSONObject> {
        val out = mutableListOf<JSONObject>()
        pendingEnd?.let { if (now >= it.deadline) pendingEnd = null }
        val away = awaySince
        val cur = op
        if (cur != null && away != null && now - away >= AWAY_MS) {
            out += opEnd(now, cur, "left")
            op = null
            awaySince = null
        }
        if (now - lastHeartbeat >= HEARTBEAT_MS) out += heartbeat(now)
        return out
    }

    private fun heartbeat(now: Long): JSONObject {
        lastHeartbeat = now
        val e = event(now, "heartbeat").put("screen", screen).put("user", user ?: JSONObject.NULL)
        op?.let { e.put("fn", it.fn).put("plate", it.plate) }
        return e
    }

    private fun opEnd(now: Long, o: Op, reason: String) =
        event(now, "op_end").put("fn", o.fn).put("plate", o.plate).put("reason", reason)

    private fun event(now: Long, type: String) = JSONObject().put("id", newId()).put("at", now).put("type", type)

    companion object {
        const val HEARTBEAT_MS = 15_000L
        const val END_CONFIRM_MS = 10_000L
        const val AWAY_MS = 120_000L
        const val BUSY_IDLE_MS = 15 * 60_000L
        const val DIAG_REPEAT_MS = 10 * 60_000L
        private val DIAG_FIELDS = listOf("reason", "path", "title", "ids", "inputs", "texts", "reader")
    }
}
