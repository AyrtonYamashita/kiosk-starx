package com.pstarx.kiosk.kiosk

/**
 * Inatividade do operador logado no SSW (perfil: kiosk.web.idleLogoutMin). Só a regra, sem tela, para testar:
 *
 *  - O tempo só corre quando vale a pena (`eligible`): modo site, alguém logado no SSW e nenhuma bipagem aberta.
 *    Fora disso o contador fica zerado — quem está bipando nunca é desconectado.
 *  - Toque, tecla (inclusive o leitor de código que digita como teclado) e digitação/rolagem na página zeram o tempo.
 *  - Passado o limite, mostra o aviso com 30 s; durante o aviso só o botão confirma (um toque qualquer não basta).
 *  - Sem confirmação até o fim dos 30 s: desconecta.
 */
class IdleLogout(private val confirmMs: Long = CONFIRM_MS) {
    enum class Action { NONE, SHOW, UPDATE, HIDE, LOGOUT }

    private var lastActivity = Long.MIN_VALUE
    /** Fim do prazo do aviso aberto (null = sem aviso). */
    var deadline: Long? = null
        private set

    val warning: Boolean get() = deadline != null

    /** Segundos que faltam no aviso (para o botão). */
    fun secondsLeft(now: Long): Int = deadline?.let { ((it - now + 999) / 1000).toInt().coerceAtLeast(0) } ?: 0

    /** Toque, tecla ou digitação. Com o aviso aberto não conta: só o botão confirma. */
    fun activity(now: Long) {
        if (deadline == null) lastActivity = now
    }

    /** O operador confirmou a presença: fecha o aviso e recomeça a contar. */
    fun confirm(now: Long) {
        deadline = null
        lastActivity = now
    }

    /** Chamado a cada segundo. `limitMs` = 0 desliga. */
    fun tick(now: Long, limitMs: Long, eligible: Boolean): Action {
        if (limitMs <= 0 || !eligible) {
            lastActivity = now
            if (deadline != null) {
                deadline = null
                return Action.HIDE
            }
            return Action.NONE
        }
        if (lastActivity == Long.MIN_VALUE) lastActivity = now
        val d = deadline
        if (d != null) {
            if (now >= d) {
                deadline = null
                lastActivity = now
                return Action.LOGOUT
            }
            return Action.UPDATE
        }
        if (now - lastActivity >= limitMs) {
            deadline = now + confirmMs
            return Action.SHOW
        }
        return Action.NONE
    }

    companion object {
        const val CONFIRM_MS = 30_000L

        /** Página do SSW com alguém logado (não é a tela de login). */
        fun loggedIn(url: String?, isSsw: Boolean): Boolean = isSsw && url != null && !url.lowercase().contains("/sswbar/login")

        private val BIPAGEM = Regex("/sswbar/(descarga|carga)/[a-z]+/[^/?#]+", RegexOption.IGNORE_CASE)

        /** Tela de bipagem aberta (descarga ou carga com a placa escolhida), pelo endereço da página. */
        fun scanningUrl(url: String?): Boolean = url != null && BIPAGEM.containsMatchIn(url)
    }
}
