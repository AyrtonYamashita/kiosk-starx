"use client";

import Link from "next/link";
import { useActionState } from "react";
import { reapplyConfig, setDeviceConfig } from "@/lib/actions";
import type { DeviceDetail, Profile } from "@/lib/api";
import { ago, configStatusLabel } from "@/lib/format";

const OVERRIDES_EXAMPLE = `{
  "kiosk": { "web": { "url": "https://outro-site.exemplo.com" } },
  "appearance": { "title": "Doca 3" }
}`;

export function DeviceConfig({ device, profiles }: { device: DeviceDetail; profiles: Pick<Profile, "id" | "name">[] }) {
  const [state, action, pending] = useActionState(setDeviceConfig, undefined);
  const [cls, label, hint] = configStatusLabel[device.configStatus];
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
        <label>
          Perfil
          <select name="profileId" defaultValue={device.profileId ?? ""}>
            <option value="">— Sem perfil (o aparelho usa a configuração feita nele)</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        {device.profileId && (
          <Link href={`/profiles/${device.profileId}`} className="small">
            Editar o perfil {device.profileName}
          </Link>
        )}
        <details open={!!device.overrides}>
          <summary className="small">Ajustes só deste aparelho (opcional)</summary>
          <label style={{ marginTop: 8 }}>
            <span className="muted small">
              JSON mesclado por cima do perfil: só o que muda para este aparelho. Vazio = igual ao perfil. Exemplo:
            </span>
            <textarea
              name="overrides"
              className="mono"
              defaultValue={device.overrides ? JSON.stringify(device.overrides, null, 2) : ""}
              placeholder={OVERRIDES_EXAMPLE}
              spellCheck={false}
            />
          </label>
        </details>
        {state?.error && <div className="alert error">{state.error}</div>}
        {state?.ok && <div className="alert ok">{state.ok}</div>}
        <div className="row">
          <button className="primary" disabled={pending}>
            {pending ? "Salvando…" : "Salvar configuração"}
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
