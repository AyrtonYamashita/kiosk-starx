"use client";

import { useActionState } from "react";
import { deleteDevice, renameDevice } from "@/lib/actions";

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
