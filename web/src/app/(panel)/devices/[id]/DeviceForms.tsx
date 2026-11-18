"use client";

import { useActionState } from "react";
import { deleteDevice, renameDevice, setOpsReader } from "@/lib/actions";

export function RenameDevice({ id, name }: { id: string; name: string }) {
  const [state, action, pending] = useActionState(renameDevice, undefined);
  return (
    <form action={action} className="row">
      <input type="hidden" name="id" value={id} />
      <label style={{ flex: 1, minWidth: 220 }}>
        Nome
        <input name="name" defaultValue={name} maxLength={80} required />
      </label>
      <button disabled={pending} style={{ alignSelf: "flex-end" }}>
        Salvar nome
      </button>
      {state?.ok && <span className="alert ok">{state.ok}</span>}
      {state?.error && <span className="alert error">{state.error}</span>}
    </form>
  );
}

/** Interruptor do piloto da leitura do SSW. */
export function OpsReaderToggle({ id, on, appVersionCode }: { id: string; on: boolean; appVersionCode: number | null }) {
  const [state, action, pending] = useActionState(setOpsReader, undefined);
  const oldApp = appVersionCode !== null && appVersionCode < OPS_MIN_VERSION_CODE;
  return (
    <form action={action} className="row">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="on" value={on ? "0" : "1"} />
      <span className={`badge ${on ? "ok" : "off"}`}>
        <span className="dot" /> {on ? "ligada" : "desligada"}
      </span>
      <button disabled={pending} className={on ? undefined : "primary"}>
        {on ? "Desligar leitura" : "Ligar leitura neste coletor"}
      </button>
      {on && oldApp && <span className="badge warn">precisa do app 0.5.0 ou mais novo</span>}
      {state?.ok && <span className="alert ok">{state.ok}</span>}
      {state?.error && <span className="alert error">{state.error}</span>}
    </form>
  );
}

/** Primeira versão do app com o leitor do SSW (0.5.0). */
const OPS_MIN_VERSION_CODE = 10;

export function DeleteDevice({ id, name }: { id: string; name: string }) {
  return (
    <form
      action={deleteDevice}
      onSubmit={(e) => {
        if (!confirm(`Remover "${name}" do painel?\n\nO aparelho continua com o kiosk, mas para de aparecer aqui até ser cadastrado de novo.`)) e.preventDefault();
      }}
      className="row"
    >
      <input type="hidden" name="id" value={id} />
      <button className="danger">Remover do painel</button>
      <span className="muted small">O kiosk do aparelho não é afetado.</span>
    </form>
  );
}
