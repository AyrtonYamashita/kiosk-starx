"use client";

import { useActionState } from "react";
import { createEnrollment } from "@/lib/actions";

const EXAMPLE = `{
  "kiosk": { "enabled": true, "mode": "apps", "apps": ["com.android.chrome"] },
  "security": { "pin": "1234" }
}`;

export function CreateEnrollment() {
  const [state, action, pending] = useActionState(createEnrollment, undefined);
  return (
    <form action={action} className="stack">
      <div className="grid">
        <label>
          Nome (ex.: loja, lote, setor)
          <input name="name" required maxLength={80} placeholder="Expedição — lote novembro" />
        </label>
        <label>
          Limite de aparelhos (vazio = sem limite)
          <input name="maxUses" type="number" min={1} />
        </label>
        <label>
          Validade em dias (vazio = sem validade)
          <input name="expiresInDays" type="number" min={1} defaultValue={30} />
        </label>
      </div>
      <details>
        <summary className="small">Configuração inicial do kiosk (opcional)</summary>
        <label style={{ marginTop: 8 }}>
          <span className="muted small">
            Mesmo JSON da tela do aparelho (docs/configuracao.md). Vai no QR: o aparelho já sai do assistente com o kiosk configurado.
            <code> security.pin</code> pode ir em texto; o aparelho grava só o hash.
          </span>
          <textarea name="initialConfig" className="mono" placeholder={EXAMPLE} />
        </label>
      </details>
      {state?.error && <div className="alert error">{state.error}</div>}
      <div>
        <button className="primary" disabled={pending}>
          {pending ? "Criando…" : "Criar código"}
        </button>
      </div>
    </form>
  );
}
