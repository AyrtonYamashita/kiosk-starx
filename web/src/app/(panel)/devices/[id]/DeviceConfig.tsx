"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { ConfigEditor } from "@/components/ConfigEditor";
import { reapplyConfig, setDeviceConfig } from "@/lib/actions";
import type { CatalogApp, DeviceDetail, Profile } from "@/lib/api";
import { ago, configStatusLabel } from "@/lib/format";

/**
 * Configuração do aparelho pelo painel: o perfil e, por cima dele, os ajustes só deste aparelho. O editor abre com
 * o perfil já aplicado; o que for mudado aqui (ex.: só o site) vira ajuste do aparelho, e o resto segue o perfil.
 */
export function DeviceConfig({
  device,
  profiles,
  catalog,
  children,
}: {
  device: DeviceDetail;
  profiles: Pick<Profile, "id" | "name" | "config">[];
  catalog: CatalogApp[];
  /** Mostrado entre o editor e o botão de salvar (na página do dispositivo: os apps gerenciados pelo perfil). */
  children?: React.ReactNode;
}) {
  const [state, action, pending] = useActionState(setDeviceConfig, undefined);
  const [profileId, setProfileId] = useState(device.profileId ?? "");
  const [cls, label, hint] = configStatusLabel[device.configStatus];
  const profile = profiles.find((p) => p.id === profileId) ?? null;
  // trocar o perfil no seletor redesenha o editor com o novo perfil como base (os ajustes continuam por cima)
  const editorKey = `${profileId}:${device.appliedAt ?? ""}`;

  return (
    <div className="stack">
      <div className="row">
        <span className={`badge ${cls}`}>{label}</span>
        <span className="muted small">{hint}</span>
        {device.appliedAt && <span className="muted small">· última aplicação {ago(device.appliedAt)}</span>}
      </div>
      {device.configStatus === "error" && device.applyError && <div className="alert error">O aparelho recusou: {device.applyError}</div>}
      {device.applyWarnings.length > 0 && device.configStatus !== "error" && (
        <div className="alert warn small">Avisos do aparelho: {device.applyWarnings.join("; ")}</div>
      )}

      <form action={action} className="stack">
        <input type="hidden" name="id" value={device.id} />
        <div className="row" style={{ alignItems: "flex-end" }}>
          <label style={{ flex: 1, minWidth: 260 }}>
            Perfil
            <select name="profileId" value={profileId} onChange={(e) => setProfileId(e.target.value)}>
              <option value="">— Sem perfil (o aparelho usa só os ajustes abaixo)</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          {profile && (
            <Link href={`/profiles/${profile.id}`} className="small" style={{ paddingBottom: 9 }}>
              Editar o perfil {profile.name} (vale para todos os aparelhos dele)
            </Link>
          )}
        </div>

        <ConfigEditor
          key={editorKey}
          name="overrides"
          base={profile?.config ?? null}
          initial={device.overrides}
          catalog={catalog}
          hasExistingPin={profile?.config?.security?.pinHash === "<definido>" || (device.overrides as Record<string, any> | null)?.security?.pinHash === "<definido>"}
        />

        {children}
        {state?.error && <div className="alert error">{state.error}</div>}
        {state?.ok && <div className="alert ok">{state.ok}</div>}
        <div className="row">
          <button className="primary" disabled={pending}>
            {pending ? "Salvando…" : "Salvar configuração deste aparelho"}
          </button>
        </div>
      </form>

      {device.configStatus !== "none" && (
        <form action={reapplyConfig} className="row">
          <input type="hidden" name="id" value={device.id} />
          <button>Reaplicar configuração do painel</button>
          <span className="muted small">Desfaz mudanças feitas no próprio aparelho (tela ou ADB).</span>
        </form>
      )}
    </div>
  );
}
