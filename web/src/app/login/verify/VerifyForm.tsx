"use client";

import { useActionState, useEffect, useState } from "react";
import { cancelMfa, resendMfaCode, verifyMfa } from "@/lib/actions";

/** Código (ABCD-2345): maiúsculas, hífen no meio, só o alfabeto válido. */
function formatInput(raw: string): string {
  const s = raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  return s.length > 4 ? `${s.slice(0, 4)}-${s.slice(4)}` : s;
}

export function VerifyForm({ methods, trustDays, initialWaitSec }: { methods: ("email" | "recovery")[]; trustDays: number; initialWaitSec: number }) {
  const [method, setMethod] = useState<"email" | "recovery">(methods.includes("email") ? "email" : "recovery");
  const [code, setCode] = useState("");
  const [state, action, pending] = useActionState(verifyMfa, undefined);
  const [resendState, resend, resending] = useActionState(resendMfaCode, undefined);
  const [wait, setWait] = useState(initialWaitSec);

  // contagem regressiva do "Reenviar código"
  useEffect(() => {
    if (resendState?.retryAfterSec) setWait(resendState.retryAfterSec);
  }, [resendState]);
  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  return (
    <div className="stack">
      <form action={action} className="stack">
        <input type="hidden" name="method" value={method} />
        <label>
          {method === "email" ? "Código do e-mail" : "Código de recuperação"}
          <input
            name="code"
            value={code}
            onChange={(e) => setCode(formatInput(e.target.value))}
            autoFocus
            autoComplete="one-time-code"
            inputMode="text"
            className="mono"
            placeholder="ABCD-2345"
            style={{ fontSize: 20, letterSpacing: "0.15em", textAlign: "center", height: 44 }}
            required
          />
        </label>
        <label className="inline">
          <input type="checkbox" name="trust" />
          Confiar neste navegador por {trustDays} dias (não pedir o código aqui)
        </label>
        {state?.error && (
          <div className="alert error">
            {state.error}
            {state.attemptsLeft !== undefined ? ` (${state.attemptsLeft} tentativa(s) restante(s))` : ""}
          </div>
        )}
        <button className="primary" disabled={pending || code.replace("-", "").length < 8}>
          {pending ? "Conferindo…" : "Entrar"}
        </button>
      </form>

      <div className="row" style={{ justifyContent: "space-between" }}>
        {method === "email" ? (
          <form action={resend}>
            <button className="link-button" disabled={resending || wait > 0}>
              {wait > 0 ? `Reenviar código em ${wait} s` : resending ? "Enviando…" : "Reenviar código"}
            </button>
          </form>
        ) : (
          <span />
        )}
        {methods.includes("recovery") && methods.includes("email") && (
          <button
            type="button"
            className="link-button"
            onClick={() => {
              setMethod(method === "email" ? "recovery" : "email");
              setCode("");
            }}
          >
            {method === "email" ? "Usar código de recuperação" : "Usar o código do e-mail"}
          </button>
        )}
      </div>
      {resendState?.ok && <div className="alert ok small">{resendState.ok}</div>}
      {resendState?.error && <div className="alert warn small">{resendState.error}</div>}
      <form action={cancelMfa}>
        <button className="link-button">Voltar e entrar com outra conta</button>
      </form>
    </div>
  );
}
