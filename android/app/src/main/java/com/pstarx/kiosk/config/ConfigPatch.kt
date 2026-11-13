package com.pstarx.kiosk.config

import com.pstarx.kiosk.security.Pin
import org.json.JSONObject

/**
 * Aplica uma alteração (parcial ou completa) sobre a configuração atual. Sem Android: testável na JVM.
 *
 *  - `security.pin` em texto (ADB, importação, painel) vira `security.pinHash`; o PIN em texto nunca é gravado.
 *  - `replace` (importar arquivo inteiro): o que não vier volta ao padrão, **exceto o PIN**, que só muda se o
 *    arquivo trouxer `pin` ou `pinHash` (um arquivo exportado sem PIN não deixa o aparelho aberto).
 */
object ConfigPatch {
    data class Result(val config: KioskConfig?, val warnings: List<String>, val error: String?) {
        val ok get() = error == null
    }

    fun apply(
        current: JSONObject,
        patch: JSONObject,
        replace: Boolean,
        hasher: (String) -> KioskConfig.PinHash = { Pin.hash(it) },
    ): Result {
        val warnings = mutableListOf<String>()
        val p = JSONObject(patch.toString())
        val schema = p.optInt("schema", KioskConfig.SCHEMA)
        if (schema > KioskConfig.SCHEMA) warnings += "configuração feita para uma versão mais nova do app (schema $schema): campos desconhecidos ignorados"
        p.remove("schema")

        val sec = p.optJSONObject("security")
        if (sec != null && sec.has("pin")) {
            val raw = sec.opt("pin")
            sec.remove("pin")
            if (raw != null && raw != JSONObject.NULL && raw.toString().isNotEmpty()) {
                val pin = raw.toString()
                Pin.validate(pin)?.let { return Result(null, warnings, "security.pin: $it") }
                sec.put("pinHash", hasher(pin).toJson())
            }
        }

        val base = if (replace) {
            val keep = JSONObject()
            val setsPin = sec?.has("pinHash") == true
            if (!setsPin) {
                current.optJSONObject("security")?.opt("pinHash")?.let { keep.put("security", JSONObject().put("pinHash", it)) }
            }
            keep
        } else {
            current
        }
        val parsed = KioskConfig.parse(KioskConfig.merge(base, p))
        return Result(parsed.config, warnings + parsed.warnings, null)
    }
}
