"use client";

import { useActionState } from "react";
import { deleteApp, deleteAppVersion, renameApp } from "@/lib/actions";

export function RenameApp({ packageName, label }: { packageName: string; label: string }) {
  const [state, action, pending] = useActionState(renameApp, undefined);
  return (
    <form action={action} className="row">
      <input type="hidden" name="packageName" value={packageName} />
      <input name="label" defaultValue={label} maxLength={80} required style={{ maxWidth: 260 }} aria-label="Nome no painel" />
      <button disabled={pending}>Salvar nome</button>
      {state?.ok && <span className="alert ok small">{state.ok}</span>}
      {state?.error && <span className="alert error small">{state.error}</span>}
    </form>
  );
}

export function DeleteVersion({ packageName, versionCode, label }: { packageName: string; versionCode: number; label: string }) {
  const [state, action, pending] = useActionState(deleteAppVersion, undefined);
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm(`Remover a versão ${versionCode} de ${label} do repositório? Os aparelhos não são afetados.`)) e.preventDefault();
      }}
    >
      <input type="hidden" name="packageName" value={packageName} />
      <input type="hidden" name="versionCode" value={versionCode} />
      <button className="link-button small" disabled={pending}>
        remover versão
      </button>
      {state?.error && <span className="alert error small">{state.error}</span>}
    </form>
  );
}

export function DeleteApp({ packageName, label }: { packageName: string; label: string }) {
  const [state, action, pending] = useActionState(deleteApp, undefined);
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm(`Remover ${label} (todas as versões) do repositório? Os aparelhos continuam com o app instalado.`)) e.preventDefault();
      }}
      className="row"
    >
      <input type="hidden" name="packageName" value={packageName} />
      <button className="danger" disabled={pending}>
        Remover do repositório
      </button>
      {state?.error && <span className="alert error small">{state.error}</span>}
    </form>
  );
}
