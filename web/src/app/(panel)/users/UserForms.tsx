"use client";

import { useActionState, useState } from "react";
import { createUser, resetUserMfa, updateUser } from "@/lib/actions";
import type { UserInfo } from "@/lib/api";
import { useConfirm } from "@/components/ConfirmDialog";

function Feedback({ state }: { state: { ok?: string; error?: string } | undefined }) {
  if (state?.error) return <div className="alert error">{state.error}</div>;
  if (state?.ok) return <div className="alert ok">{state.ok}</div>;
  return null;
}

export function CreateUserForm() {
  const [state, action, pending] = useActionState(createUser, undefined);
  return (
    <form action={action} className="stack">
      <div className="grid">
        <label>
          Usuário (login)
          <input name="username" required minLength={3} maxLength={64} placeholder="joao.silva" />
        </label>
        <label>
          E-mail
          <input name="email" type="email" required maxLength={200} placeholder="joao@pstarx.com" />
        </label>
        <label>
          Papel
          <select name="role" defaultValue="operator">
            <option value="operator">Operador</option>
            <option value="admin">Administrador</option>
          </select>
        </label>
      </div>
      <div className="grid">
        <label>
          Senha inicial (mínimo 10 caracteres)
          <input name="password" type="password" required minLength={10} autoComplete="new-password" />
        </label>
        <label>
          Repita a senha
          <input name="confirm" type="password" required minLength={10} autoComplete="new-password" />
        </label>
      </div>
      <Feedback state={state} />
      <div>
        <button className="primary" disabled={pending}>
          {pending ? "Criando…" : "Criar usuário"}
        </button>
      </div>
    </form>
  );
}

/** Editar e-mail e papel, redefinir senha e ativar/desativar (desativar e trocar papel/senha encerram as sessões). */
export function EditUser({ user, self }: { user: UserInfo; self: boolean }) {
  const ask = useConfirm();
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(updateUser, undefined);
  const [mfaState, resetMfa, resetting] = useActionState(resetUserMfa, undefined);
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}>
        Editar
      </button>
    );
  }
  return (
    <form action={action} className="stack" style={{ minWidth: 280, textAlign: "left" }}>
      <input type="hidden" name="id" value={user.id} />
      <label>
        E-mail
        <input name="email" type="email" defaultValue={user.email ?? ""} maxLength={200} />
      </label>
      {!self && (
        <label>
          Papel
          <select name="role" defaultValue={user.role}>
            <option value="operator">Operador</option>
            <option value="admin">Administrador</option>
          </select>
        </label>
      )}
      <label>
        Nova senha (opcional)
        <input name="password" type="password" minLength={10} autoComplete="new-password" placeholder="deixe vazio para manter" />
      </label>
      {!self && (
        <label>
          Situação
          <select name="disabled" defaultValue={user.disabled ? "1" : "0"}>
            <option value="0">Ativo</option>
            <option value="1">Desativado (não entra; sessões encerradas)</option>
          </select>
        </label>
      )}
      <Feedback state={state} />
      <div className="row">
        <button className="primary" disabled={pending}>
          {pending ? "Salvando…" : "Salvar"}
        </button>
        <button type="button" className="link-button" onClick={() => setOpen(false)}>
          fechar
        </button>
      </div>
      <div className="row" style={{ borderTop: "1px solid var(--rule)", paddingTop: 10 }}>
        <button
          type="submit"
          formAction={resetMfa}
          className="danger"
          disabled={resetting}
          onClick={(e) =>
            ask.click(e, {
              title: `Zerar o 2FA de ${user.username}?`,
              message: `Apaga os códigos de recuperação e os navegadores confiáveis${self ? "" : " e encerra as sessões"}.`,
              confirmLabel: "Zerar 2FA",
              danger: true,
            })
          }
        >
          Zerar 2FA (perdeu o acesso)
        </button>
      </div>
      <Feedback state={mfaState} />
    </form>
  );
}
