"use client";

import { useActionToast } from "@/components/Toasts";
import { useActionState } from "react";
import { changePassword } from "@/lib/actions";

export function PasswordForm() {
  const [state, action, pending] = useActionState(changePassword, undefined);
  useActionToast(state);
  return (
    <form action={action} className="stack">
      <label>
        Senha atual
        <input name="current" type="password" autoComplete="current-password" required />
      </label>
      <label>
        Nova senha (mínimo 10 caracteres)
        <input name="next" type="password" autoComplete="new-password" minLength={10} required />
      </label>
      <label>
        Repita a nova senha
        <input name="confirm" type="password" autoComplete="new-password" minLength={10} required />
      </label>
      {state?.error && <div className="alert error">{state.error}</div>}
      <div>
        <button className="primary" disabled={pending}>
          Trocar senha
        </button>
      </div>
    </form>
  );
}
