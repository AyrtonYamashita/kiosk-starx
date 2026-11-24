"use client";

import { useActionToast } from "@/components/Toasts";
import { useConfirm } from "@/components/ConfirmDialog";
import { useActionState, useState } from "react";
import { createTenant, updateTenant } from "@/lib/actions";
import type { PlatformTenant } from "@/lib/api";

/** Empresa nova com o primeiro administrador (ele troca a senha em Conta). */
export function CreateTenantForm() {
  const [state, action, pending] = useActionState(createTenant, undefined);
  useActionToast(state);
  return (
    <form action={action} className="stack">
      <div className="grid">
        <label>
          Nome da empresa
          <input name="name" required minLength={2} maxLength={80} placeholder="Transportadora Exemplo" />
        </label>
        <label>
          Apelido (minúsculas, números e hífen)
          <input name="slug" required pattern="[a-z0-9][a-z0-9-]{1,39}" maxLength={40} placeholder="exemplo" autoCapitalize="none" spellCheck={false} />
        </label>
      </div>
      <span className="section-label">Primeiro administrador</span>
      <div className="grid">
        <label>
          Nome
          <input name="displayName" maxLength={80} placeholder="Maria Silva" />
        </label>
        <label>
          Usuário (login)
          <input name="username" required minLength={3} maxLength={64} placeholder="maria.silva" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
        </label>
        <label>
          E-mail
          <input name="email" type="email" required maxLength={200} placeholder="maria@exemplo.com.br" />
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
      {state?.error && <div className="alert error">{state.error}</div>}
      <div>
        <button className="primary" disabled={pending}>
          {pending ? "Criando…" : "Criar empresa"}
        </button>
      </div>
    </form>
  );
}

/** Renomear e suspender/reativar (suspender derruba as sessões dos usuários da empresa). */
export function TenantStatus({ tenant }: { tenant: PlatformTenant }) {
  const ask = useConfirm();
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(updateTenant, undefined);
  useActionToast(state);
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}>
        Editar
      </button>
    );
  }
  const suspending = tenant.status === "active";
  return (
    <form action={action} className="stack" style={{ minWidth: 240, textAlign: "left" }}>
      <input type="hidden" name="id" value={tenant.id} />
      <label>
        Nome
        <input name="name" defaultValue={tenant.name} minLength={2} maxLength={80} />
      </label>
      {state?.error && <div className="alert error">{state.error}</div>}
      <div className="row">
        <button className="primary" disabled={pending}>
          Salvar
        </button>
        <button
          type="submit"
          name="status"
          value={suspending ? "suspended" : "active"}
          className={suspending ? "danger" : undefined}
          disabled={pending}
          onClick={(e) =>
            suspending &&
            ask.click(e, {
              title: `Suspender ${tenant.name}?`,
              message: "Os usuários da empresa saem na hora e não entram até reativar. Os coletores continuam funcionando.",
              confirmLabel: "Suspender",
              danger: true,
            })
          }
        >
          {suspending ? "Suspender" : "Reativar"}
        </button>
        <button type="button" className="link-button" onClick={() => setOpen(false)}>
          fechar
        </button>
      </div>
    </form>
  );
}
