"use client";

import { useActionToast } from "@/components/Toasts";
import { useActionState } from "react";
import { updateMyName } from "@/lib/actions";

/** Nome de exibição (o login continua sendo o nome de usuário). */
export function NameForm({ current, placeholder }: { current: string | null; placeholder: string }) {
  const [state, action, pending] = useActionState(updateMyName, undefined);
  useActionToast(state);
  return (
    <form action={action} className="row" style={{ gap: 8, alignItems: "flex-end" }}>
      <label style={{ flex: 1, minWidth: 0 }}>
        Nome
        <input name="displayName" defaultValue={current ?? ""} maxLength={80} placeholder={placeholder} />
      </label>
      <button disabled={pending}>{pending ? "Salvando…" : "Salvar"}</button>
      {state?.error && <div className="alert error">{state.error}</div>}
    </form>
  );
}
