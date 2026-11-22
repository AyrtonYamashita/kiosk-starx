"use client";

import { useConfirm } from "@/components/ConfirmDialog";
import { useActionState } from "react";
import { generateRecoveryCodes, revokeTrustedDevice } from "@/lib/actions";
import type { MfaInfo } from "@/lib/api";

function device(ua: string | null): string {
  if (!ua) return "—";
  const b = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Navegador";
  const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Mac OS/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${b} · ${os}` : b;
}

const fmt = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });

/** Códigos de recuperação: quantos restam e o botão para gerar novos (mostrados uma vez só). */
export function RecoveryCodes({ left }: { left: number }) {
  const ask = useConfirm();
  const [state, generate, pending] = useActionState(generateRecoveryCodes, undefined);
  return (
    <div className="stack" style={{ gap: 10 }}>
      <span className="muted small">
        <span className="mono">{left}</span> disponíveis. Servem para entrar sem passkey, e-mail ou app; cada um vale uma vez.
      </span>
      {state?.codes ? (
        <div className="alert warn" style={{ flexDirection: "column", alignItems: "stretch" }}>
          <strong>Guarde estes códigos agora: eles não aparecem de novo.</strong>
          <div className="mono" style={{ display: "grid", gridTemplateColumns: "repeat(2, max-content)", gap: "4px 24px", margin: "8px 0", fontSize: 14 }}>
            {state.codes.map((c) => (
              <span key={c}>{c}</span>
            ))}
          </div>
          <button type="button" onClick={() => navigator.clipboard?.writeText(state.codes!.join("\n"))} style={{ alignSelf: "flex-start" }}>
            Copiar
          </button>
        </div>
      ) : (
        <form
          action={generate}
          onSubmit={(e) => {
            if (left > 0) ask.submit(e, { title: "Gerar códigos novos?", message: "Os códigos de recuperação anteriores deixam de valer.", confirmLabel: "Gerar códigos", danger: true });
          }}
        >
          <button disabled={pending}>{left > 0 ? "Gerar códigos novos" : "Gerar códigos de recuperação"}</button>
        </form>
      )}
      {state?.error && <div className="alert error">{state.error}</div>}
    </div>
  );
}

/** Navegadores em que o código não é pedido por alguns dias (a senha continua). */
export function TrustedDevices({ info }: { info: MfaInfo }) {
  return (
    <div className="stack" style={{ gap: 10 }}>
      <span className="muted small">
        Nestes navegadores o código não é pedido por {info.trustDays} dias (a senha continua). Trocar a senha remove todos.
      </span>
      {info.trustedDevices.length === 0 ? (
        <span className="muted small">Nenhum.</span>
      ) : (
        <div className="table-wrap">
          <table>
            <tbody>
              {info.trustedDevices.map((d) => (
                <tr key={d.id}>
                  <td>
                    {device(d.userAgent)}
                    <div className="muted small mono">{d.ip ?? "—"}</div>
                  </td>
                  <td className="small">
                    desde {fmt(d.createdAt)}
                    <div className="muted">até {fmt(d.expiresAt)}</div>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <form action={revokeTrustedDevice}>
                      <input type="hidden" name="id" value={d.id} />
                      <button className="danger">Remover</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
