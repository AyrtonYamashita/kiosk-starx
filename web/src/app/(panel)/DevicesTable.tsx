"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { bulkAssignProfile } from "@/lib/actions";
import type { DeviceSummary, Profile } from "@/lib/api";
import { ago, configStatusLabel, kioskModeLabel, networkLabel } from "@/lib/format";

function Battery({ b }: { b: DeviceSummary["battery"] }) {
  if (!b || b.level === null || b.level === undefined) return <span className="muted">—</span>;
  const cls = b.charging ? "ok" : b.level <= 15 ? "danger" : b.level <= 30 ? "warn" : "off";
  return (
    <span className={`badge ${cls}`}>
      {b.level}%{b.charging ? " ⚡" : ""}
    </span>
  );
}

export function DevicesTable({ devices, profiles }: { devices: DeviceSummary[]; profiles: Pick<Profile, "id" | "name">[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [state, action, pending] = useActionState(bulkAssignProfile, undefined);
  const all = devices.length > 0 && selected.size === devices.length;
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <div className="stack">
      {selected.size > 0 && (
        <form action={action} className="card row" style={{ padding: "10px 14px" }}>
          {[...selected].map((id) => (
            <input key={id} type="hidden" name="deviceId" value={id} />
          ))}
          <strong>{selected.size} selecionado(s)</strong>
          <select name="profileId" required defaultValue="" style={{ width: "auto", minWidth: 220 }}>
            <option value="" disabled>
              Aplicar perfil…
            </option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
            <option value="__none__">— Sem perfil (configuração local)</option>
          </select>
          <button className="primary" disabled={pending}>
            Aplicar
          </button>
          <button type="button" className="link-button" onClick={() => setSelected(new Set())}>
            limpar seleção
          </button>
          {state?.ok && <span className="alert ok">{state.ok}</span>}
          {state?.error && <span className="alert error">{state.error}</span>}
        </form>
      )}
      <div className="card table-wrap" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th style={{ width: 32 }}>
                <input type="checkbox" aria-label="Selecionar todos" checked={all} onChange={() => setSelected(all ? new Set() : new Set(devices.map((d) => d.id)))} />
              </th>
              <th>Aparelho</th>
              <th>Status</th>
              <th>Bateria</th>
              <th className="hide-sm">Rede</th>
              <th className="hide-sm">Kiosk / perfil</th>
              <th className="hide-sm">App</th>
            </tr>
          </thead>
          <tbody>
            {devices.map((d) => {
              const [cls, label, hint] = configStatusLabel[d.configStatus];
              return (
                <tr key={d.id}>
                  <td>
                    <input type="checkbox" aria-label={`Selecionar ${d.name}`} checked={selected.has(d.id)} onChange={() => toggle(d.id)} />
                  </td>
                  <td>
                    <Link href={`/devices/${d.id}`}>
                      <strong>{d.name}</strong>
                    </Link>
                    <div className="muted small">
                      {[d.manufacturer, d.model].filter(Boolean).join(" ")} · {d.serial ?? "sem serial"}
                    </div>
                  </td>
                  <td>
                    <span className={`badge ${d.online ? "ok" : "off"}`}>
                      <span className="dot" /> {d.online ? "online" : "offline"}
                    </span>
                    <div className="muted small">{ago(d.lastSeenAt)}</div>
                  </td>
                  <td>
                    <Battery b={d.battery} />
                  </td>
                  <td className="hide-sm">
                    {d.network ? (
                      <>
                        {networkLabel[d.network.type] ?? d.network.type}
                        {d.network.ssid ? ` · ${d.network.ssid}` : ""}
                        <div className="muted small mono">{d.network.ip ?? ""}</div>
                      </>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td className="hide-sm">
                    {d.kioskEnabled ? kioskModeLabel[d.kioskMode ?? ""] ?? d.kioskMode : d.kioskEnabled === false ? <span className="muted">kiosk desligado</span> : "—"}
                    <div className="small">
                      {d.profileName ? <>perfil {d.profileName}{d.hasOverrides ? " + ajustes" : ""}</> : <span className="muted">sem perfil</span>}{" "}
                      {d.configStatus !== "none" && (
                        <span className={`badge ${cls}`} title={hint}>
                          {label}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="hide-sm">
                    {d.appVersion ?? "—"}
                    <div className="muted small">Android {d.androidVersion ?? "?"}</div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
