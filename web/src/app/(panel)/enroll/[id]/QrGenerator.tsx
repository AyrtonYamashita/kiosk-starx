"use client";

import { useActionState } from "react";
import { generateQr } from "@/lib/actions";

export function QrGenerator({ id }: { id: string }) {
  const [state, action, pending] = useActionState(generateQr, undefined);
  return (
    <div className="stack">
      <form action={action} className="stack">
        <input type="hidden" name="id" value={id} />
        <div className="grid">
          <label>
            Wi-Fi (opcional): nome da rede
            <input name="ssid" maxLength={64} autoComplete="off" />
          </label>
          <label>
            Senha do Wi-Fi
            <input name="password" type="password" maxLength={128} autoComplete="new-password" />
          </label>
        </div>
        <label className="check-label small">
          <input type="checkbox" name="hidden" /> rede oculta
        </label>
        <span className="muted small">A senha do Wi-Fi entra só no QR; não fica gravada no servidor.</span>
        <div>
          <button className="primary" disabled={pending}>
            {pending ? "Gerando…" : state?.svg ? "Gerar de novo" : "Gerar QR"}
          </button>
        </div>
      </form>
      {state?.error && <div className="alert error">{state.error}</div>}
      {state?.svg && (
        <div className="stack">
          <div className="qr" dangerouslySetInnerHTML={{ __html: state.svg }} />
          <details>
            <summary className="small">Conteúdo do QR</summary>
            <pre className="json mono small" style={{ marginTop: 8 }}>
              {JSON.stringify(JSON.parse(state.payload!), null, 2)}
            </pre>
          </details>
        </div>
      )}
    </div>
  );
}
