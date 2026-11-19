"use client";

import { useActionState, useState } from "react";
import { confirmTotp, disableTotp, setupTotp } from "@/lib/actions";

const fmt = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });

function Feedback({ state }: { state: { ok?: string; error?: string } | undefined }) {
  if (state?.error) return <div className="alert error">{state.error}</div>;
  if (state?.ok) return <div className="alert ok">{state.ok}</div>;
  return null;
}

/** App autenticador (opcional): ativar com QR Code + primeiro código; desativar com a senha. */
export function TotpSection({ enabled, since }: { enabled: boolean; since: string | null }) {
  const [open, setOpen] = useState(false);
  const [openDisable, setOpenDisable] = useState(false);
  const [setup, startSetup, starting] = useActionState(setupTotp, undefined);
  const [confirmState, confirm, confirming] = useActionState(confirmTotp, undefined);
  const [disableState, disable, disabling] = useActionState(disableTotp, undefined);
  const [code, setCode] = useState("");

  if (enabled) {
    return (
      <div className="stack">
        <span className="small">
          <span className="badge ok">ativo</span> desde {since ? fmt(since) : "—"}. No login o código é pedido pelo app; o e-mail fica como alternativa.
        </span>
        <Feedback state={confirmState} />
        {openDisable ? (
          <form action={disable} className="stack">
            <label>
              Senha atual
              <input name="password" type="password" required autoComplete="current-password" />
            </label>
            <Feedback state={disableState} />
            <div className="row">
              <button className="danger" disabled={disabling}>
                {disabling ? "Desativando…" : "Desativar app autenticador"}
              </button>
              <button type="button" className="link-button" onClick={() => setOpenDisable(false)}>
                cancelar
              </button>
            </div>
          </form>
        ) : (
          <div>
            <button type="button" onClick={() => setOpenDisable(true)}>
              Desativar
            </button>
          </div>
        )}
      </div>
    );
  }

  if (setup?.secret && setup.svg) {
    return (
      <div className="stack">
        <span className="small">
          1. No app autenticador (Google Authenticator, Microsoft Authenticator, Authy…), adicione uma conta lendo o QR Code:
        </span>
        <div
          aria-label="QR Code do app autenticador"
          style={{ width: 184, height: 184, background: "var(--qr-bg)", borderRadius: "var(--radius-field)", padding: 4 }}
          // SVG gerado no servidor pela biblioteca qrcode a partir do otpauth:// da API
          dangerouslySetInnerHTML={{ __html: setup.svg }}
        />
        <span className="muted small">
          Sem câmera? Digite a chave: <span className="mono">{setup.secret.match(/.{1,4}/g)?.join(" ")}</span>
        </span>
        <form action={confirm} className="stack">
          <label>
            2. Digite o código de 6 dígitos que aparece no app
            <input
              name="code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              className="mono"
              placeholder="123456"
              style={{ fontSize: 18, letterSpacing: "0.2em", maxWidth: 180 }}
              required
            />
          </label>
          <Feedback state={confirmState} />
          <div>
            <button className="primary" disabled={confirming || code.length !== 6}>
              {confirming ? "Conferindo…" : "Ativar"}
            </button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="stack">
      <span className="muted small">Opcional. Com o app ativo, o login pede o código do celular em vez de enviar e-mail.</span>
      {open ? (
        <form action={startSetup} className="stack">
          <label>
            Senha atual
            <input name="password" type="password" required autoComplete="current-password" />
          </label>
          <Feedback state={setup} />
          <div className="row">
            <button className="primary" disabled={starting}>
              {starting ? "Gerando…" : "Continuar"}
            </button>
            <button type="button" className="link-button" onClick={() => setOpen(false)}>
              cancelar
            </button>
          </div>
        </form>
      ) : (
        <div>
          <button type="button" onClick={() => setOpen(true)}>
            Ativar app autenticador
          </button>
        </div>
      )}
      <Feedback state={disableState} />
    </div>
  );
}
