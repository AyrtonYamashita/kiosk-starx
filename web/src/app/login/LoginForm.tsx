"use client";

import { useActionState } from "react";
import { login } from "@/lib/actions";

export function LoginForm() {
  const [state, action, pending] = useActionState(login, undefined);
  return (
    <form action={action} className="stack">
      <label>
        Usuário ou e-mail
        <input name="username" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} required autoFocus />
      </label>
      <label>
        Senha
        <input name="password" type="password" autoComplete="current-password" required />
      </label>
      {state?.error && <div className="alert error">{state.error}</div>}
      <button className="primary" disabled={pending}>
        {pending ? "Entrando…" : "Entrar"}
      </button>
    </form>
  );
}
