"use client";

import { Toggle } from "@/components/Toggle";
import { useActionToast } from "@/components/Toasts";
import { useActionState } from "react";
import { ConfigEditor } from "@/components/ConfigEditor";
import { saveProfile } from "@/lib/actions";
import type { CatalogApp, Profile, RepoApp } from "@/lib/api";

/**
 * Ponto de partida de um perfil novo. A localização nasce desligada (LGPD: minimização, .lgpd/kit-cliente/lia-modelos/
 * localizacao-coletores.md): o cliente liga só onde precisar. Perfis existentes não mudam (o padrão geral do editor e
 * do app continua "ligado" para quem não tem o campo gravado).
 */
const NEW_PROFILE_CONFIG = { security: { reportLocation: false } };

export function ProfileForm({ profile, catalog, repo, justSaved }: { profile: Profile | null; catalog: CatalogApp[]; repo: RepoApp[]; justSaved?: boolean }) {
  const [state, action, pending] = useActionState(saveProfile, justSaved ? { ok: "Perfil criado." } : undefined);
  useActionToast(state);
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
        <ConfigEditor key={profile?.updatedAt ?? "novo"} name="config" initial={profile?.config ?? NEW_PROFILE_CONFIG} catalog={catalog} hasExistingPin={profile?.config?.security?.pinHash === "<definido>"} />
      </section>
      <section className="card stack">
        <h2 style={{ margin: 0 }}>Apps gerenciados</h2>
        <input type="hidden" name="managedAppsPresent" value="1" />
        <span className="muted small">
          Os aparelhos com este perfil instalam estes apps e os mantêm na versão mais nova do repositório, sem pedir nada na tela. Tirar daqui não remove o app dos
          aparelhos.
        </span>
        {repo.length === 0 ? (
          <span className="muted small">
            O repositório está vazio: envie APKs no menu <a href="/apps">Apps</a>.
          </span>
        ) : (
          <div className="grid" style={{ gap: 6 }}>
            {repo.map((a) => (
              <label key={a.packageName} className="check-label">
                <Toggle name="managedApp" value={a.packageName} defaultChecked={profile?.managedApps.includes(a.packageName)} />
                <span>
                  {a.label} <span className="muted small">{a.versions[0] ? `${a.versions[0].versionName ?? ""} (${a.versions[0].versionCode})` : ""}</span>
                </span>
              </label>
            ))}
          </div>
        )}
      </section>
      {state?.error && <div className="alert error">{state.error}</div>}
      <div>
        <button className="primary" disabled={pending}>
          {pending ? "Salvando…" : "Salvar perfil"}
        </button>
      </div>
    </form>
  );
}
