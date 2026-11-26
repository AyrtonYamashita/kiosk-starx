package com.pstarx.kiosk.kiosk

import android.content.Context
import android.webkit.WebResourceResponse
import com.pstarx.kiosk.R
import java.io.InputStream

/**
 * Fontes da identidade (Inter, Space Grotesk, IBM Plex Mono) para as telas que o leitor do SSW desenha por cima da
 * página (ssw_reader.js pede em /__starx/fonts/<arquivo> no próprio endereço do SSW). Saem do APK: sem internet e sem
 * nada indo ao SSW.
 */
object KioskFonts {
    const val PATH = "/__starx/fonts/"

    private val FILES: Map<String, (Context) -> InputStream> = mapOf(
        "inter.ttf" to { c -> c.resources.openRawResource(R.font.inter_variable) },
        "spacegrotesk.ttf" to { c -> c.resources.openRawResource(R.font.spacegrotesk_variable) },
        "plexmono-regular.ttf" to { c -> c.assets.open("fonts/plexmono-regular.ttf") },
        "plexmono-medium.ttf" to { c -> c.assets.open("fonts/plexmono-medium.ttf") },
    )

    /** A fonte pedida, ou 404 para qualquer outro nome dentro de [PATH]. */
    fun response(ctx: Context, name: String?): WebResourceResponse {
        val open = FILES[name]
        val headers = mapOf("Access-Control-Allow-Origin" to "*", "Cache-Control" to "max-age=31536000")
        if (open == null) return WebResourceResponse("text/plain", "utf-8", 404, "Not Found", headers, "".byteInputStream())
        return WebResourceResponse("font/ttf", null, 200, "OK", headers, open(ctx))
    }
}
