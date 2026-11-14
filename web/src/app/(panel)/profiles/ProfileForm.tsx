"use client";

import { useActionState } from "react";
import { ConfigEditor } from "@/components/ConfigEditor";
import { saveProfile } from "@/lib/actions";
import type { CatalogApp, Profile } from "@/lib/api";

export function ProfileForm({ profile, catalog, justSaved }: { profile: Profile | null; catalog: CatalogApp[]; justSaved?: boolean }) {
  const [state, action, pending] = useActionState(saveProfile, justSaved ? { ok: "Perfil criado." } : undefined);
  return (
    <form action={action} className="stack">
      {profile && <input type="hidden" name="id" value={profile.id} />}
      <div className="grid">
        <label>
          Nome
          <input name="name" defaultValue={profile?.name ?? ""} required maxLength={80} placeholder="Expedição" />
        </label>
        <label>
          Descrição (opcional)
          <input name="description" defaultValue={profile?.description ?? ""} maxLength={500} />
        </label>
      </div>
      <section className="card">
        <ConfigEditor key={profile?.updatedAt ?? "novo"} name="config" initial={profile?.config ?? null} catalog={catalog} hasExistingPin={profile?.config?.security?.pinHash === "<definido>"} />
      </section>
      {state?.error && <div className="alert error">{state.error}</div>}
      {state?.ok && <div className="alert ok">{state.ok}</div>}
      <div>
        <button className="primary" disabled={pending}>
          {pending ? "Salvando…" : "Salvar perfil"}
        </button>
      </div>
    </form>
  );
}
