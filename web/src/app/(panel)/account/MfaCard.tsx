"use client";

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

/** Segundo fator na Conta: como entra (e-mail), códigos de recuperação e navegadores confiáveis. */
export function MfaCard({ info }: { info: MfaInfo }) {
  const [state, generate, pending] = useActionState(generateRecoveryCodes, undefined);
  return (
    <div className="stack">
      <dl className="kv">
        <dt>Segundo fator</dt>
        <dd>
          {info.required ? <span className="badge ok">obrigatório</span> : <span className="badge off">ainda opcional</span>} código por e-mail para{" "}
          <span className="mono">{info.email ?? "— (sem e-mail: peça ao administrador)"}</span>
        </dd>
        <dt>Códigos de recuperação</dt>
        <dd>
          <span className="mono">{info.recoveryCodesLeft}</span> disponíveis
          <div className="muted small">Para entrar quando o e-mail não estiver acessível. Cada um vale uma vez.</div>
        </dd>
      </dl>

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
            if (info.recoveryCodesLeft > 0 && !confirm("Gerar códigos novos? Os anteriores deixam de valer.")) e.preventDefault();
          }}
        >
          <button disabled={pending}>{info.recoveryCodesLeft > 0 ? "Gerar códigos novos" : "Gerar códigos de recuperação"}</button>
        </form>
      )}
      {state?.error && <div className="alert error">{state.error}</div>}

      <strong className="small">Navegadores confiáveis ({info.trustedDevices.length})</strong>
      <span className="muted small">Nestes navegadores o código não é pedido por {info.trustDays} dias (a senha continua). Trocar a senha remove todos.</span>
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
