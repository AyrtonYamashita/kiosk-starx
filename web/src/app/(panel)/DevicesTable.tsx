"use client";

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import { Search, Zap } from "lucide-react";
import { bulkAssignProfile, sendCommand } from "@/lib/actions";
import type { DeviceSummary, Profile } from "@/lib/api";
import { ago, configStatusLabel, kioskModeLabel, networkLabel, uptime } from "@/lib/format";

/** Bateria: ícone preenchido até o nível, cor pela faixa e raio quando carrega. Offline não mostra (o dado é velho). */
function Battery({ b, online }: { b: DeviceSummary["battery"]; online: boolean }) {
  if (!online || !b || b.level === null || b.level === undefined) return <span className="muted">—</span>;
  const tone = b.level <= 15 && !b.charging ? "bad" : b.level <= 30 && !b.charging ? "warn" : "good";
  const label = `${b.level}%${b.charging ? ", carregando" : b.level <= 15 ? ", bateria baixa" : ""}`;
  return (
    <span className={`batt ${tone}`} title={label} aria-label={`Bateria ${label}`}>
      <span className="batt-body" aria-hidden>
        <span className="batt-fill" style={{ width: `${Math.max(4, Math.min(100, b.level))}%` }} />
      </span>
      <span className="batt-n">{b.level}%</span>
      {b.charging && <Zap size={13} strokeWidth={2} className="batt-zap" aria-hidden />}
    </span>
  );
}

function BulkCommand({ ids, repo }: { ids: string[]; repo: { packageName: string; label: string }[] }) {
  const [state, action, pending] = useActionState(sendCommand, undefined);
  const [type, setType] = useState("");
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (type === "reboot" && !confirm(`Reiniciar ${ids.length} aparelho(s)?`)) e.preventDefault();
      }}
      className="row"
    >
      {ids.map((id) => (
        <input key={id} type="hidden" name="deviceId" value={id} />
      ))}
      <select name="type" required value={type} onChange={(e) => setType(e.target.value)} style={{ width: "auto", minWidth: 200 }}>
        <option value="" disabled>
          Enviar comando…
        </option>
        <option value="lock">Bloquear tela</option>
        <option value="reload">Recarregar kiosk</option>
        <option value="screenshot">Capturar tela</option>
        <option value="message">Mensagem</option>
        <option value="install_app">Instalar app (mais nova)</option>
        <option value="reboot">Reiniciar</option>
      </select>
      {type === "message" && <input name="text" required maxLength={1000} placeholder="Mensagem (fica na tela até tocarem em OK)" style={{ width: "auto", minWidth: 280 }} />}
      {type === "install_app" && (
        <select name="app" required defaultValue="" style={{ width: "auto", minWidth: 200 }}>
          <option value="" disabled>
            {repo.length ? "App…" : "repositório vazio"}
          </option>
          {repo.map((a) => (
            <option key={a.packageName} value={a.packageName}>
              {a.label}
            </option>
          ))}
        </select>
      )}
      <button disabled={pending || !type}>Enviar</button>
      {state?.ok && <span className="alert ok small">{state.ok}</span>}
      {state?.error && <span className="alert error small">{state.error}</span>}
    </form>
  );
}

function msSince(iso: string | null) {
  return iso ? Math.max(0, Date.now() - new Date(iso).getTime()) : 0;
}

const modelOf = (d: DeviceSummary) => [d.manufacturer, d.model].filter(Boolean).join(" ") || "sem modelo";

/** Texto em que a busca procura: série, modelo, MAC, IP e rede (e o nome). */
function haystack(d: DeviceSummary) {
  const n = d.network;
  return [d.name, d.serial, modelOf(d), n?.mac, n?.ip, d.lastIp, n?.ssid, n ? networkLabel[n.type] ?? n.type : null]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

type Filters = { q: string; status: "online" | "offline" | "all"; user: string; profile: string; model: string };
const DEFAULTS: Filters = { q: "", status: "online", user: "", profile: "", model: "" };

export function DevicesTable({
  devices,
  profiles,
  repo,
}: {
  devices: DeviceSummary[];
  profiles: Pick<Profile, "id" | "name">[];
  repo: { packageName: string; label: string }[];
}) {
  const [f, setF] = useState<Filters>(DEFAULTS);
  const set = (patch: Partial<Filters>) => setF((cur) => ({ ...cur, ...patch }));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [state, action, pending] = useActionState(bulkAssignProfile, undefined);

  const options = useMemo(
    () => ({
      users: [...new Set(devices.map((d) => d.loggedUser).filter((u): u is string => !!u))].sort((a, b) => a.localeCompare(b, "pt-BR")),
      models: [...new Set(devices.map(modelOf))].sort((a, b) => a.localeCompare(b, "pt-BR")),
    }),
    [devices],
  );

  const list = useMemo(() => {
    const q = f.q.trim().toLowerCase();
    return devices.filter(
      (d) =>
        (f.status === "all" || (f.status === "online") === d.online) &&
        (!f.user || (f.user === "__any__" ? !!d.loggedUser : f.user === "__none__" ? !d.loggedUser : d.loggedUser === f.user)) &&
        (!f.profile || (f.profile === "__none__" ? !d.profileId : d.profileId === f.profile)) &&
        (!f.model || modelOf(d) === f.model) &&
        (!q || haystack(d).includes(q)),
    );
  }, [devices, f]);

  const changed = JSON.stringify(f) !== JSON.stringify(DEFAULTS);
  const all = list.length > 0 && list.every((d) => selected.has(d.id));
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <div className="stack">
      <div className="dev-filters" role="search">
        <label className="dev-search">
          <Search size={16} strokeWidth={1.75} aria-hidden />
          <input type="search" value={f.q} onChange={(e) => set({ q: e.target.value })} placeholder="Buscar série, modelo, MAC, IP ou rede" aria-label="Buscar aparelho" />
        </label>
        <select value={f.status} onChange={(e) => set({ status: e.target.value as Filters["status"] })} aria-label="Status">
          <option value="online">Online</option>
          <option value="offline">Offline</option>
          <option value="all">Online e offline</option>
        </select>
        <select value={f.user} onChange={(e) => set({ user: e.target.value })} aria-label="Usuário no SSW">
          <option value="">Qualquer usuário</option>
          <option value="__any__">Com usuário logado</option>
          <option value="__none__">Sem usuário</option>
          {options.users.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
        <select value={f.profile} onChange={(e) => set({ profile: e.target.value })} aria-label="Perfil">
          <option value="">Qualquer perfil</option>
          <option value="__none__">Sem perfil</option>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select value={f.model} onChange={(e) => set({ model: e.target.value })} aria-label="Modelo">
          <option value="">Qualquer modelo</option>
          {options.models.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <span className="muted small dev-count">
          {list.length} de {devices.length}
        </span>
        {changed && (
          <button type="button" className="link-button" onClick={() => setF(DEFAULTS)}>
            limpar filtros
          </button>
        )}
      </div>

      {selected.size > 0 && (
        <div className="card stack" style={{ padding: "10px 14px", gap: 10 }}>
          <form action={action} className="row">
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
          <BulkCommand ids={[...selected]} repo={repo} />
        </div>
      )}

      {list.length === 0 ? (
        <div className="card muted">
          Nenhum aparelho com esses filtros.{" "}
          <button type="button" className="link-button" onClick={() => setF(DEFAULTS)}>
            limpar filtros
          </button>
        </div>
      ) : (
        <div className="card table-wrap" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th style={{ width: 32 }}>
                  <input
                    type="checkbox"
                    aria-label="Selecionar todos os exibidos"
                    checked={all}
                    onChange={() => setSelected(all ? new Set() : new Set(list.map((d) => d.id)))}
                  />
                </th>
                <th>Aparelho</th>
                <th>Status</th>
                <th className="hide-sm">Usuário</th>
                <th className="hide-sm">Bateria</th>
                <th className="hide-sm">Rede</th>
                <th className="hide-sm">Ligado há</th>
                <th className="hide-sm">Kiosk / perfil</th>
                <th className="hide-sm">App</th>
              </tr>
            </thead>
            <tbody>
              {list.map((d) => {
                const [, label, hint] = configStatusLabel[d.configStatus];
                const mode = d.kioskEnabled ? kioskModeLabel[d.kioskMode ?? ""] ?? d.kioskMode : d.kioskEnabled === false ? "Kiosk desligado" : "—";
                return (
                  <tr key={d.id}>
                    <td>
                      <input type="checkbox" aria-label={`Selecionar ${d.name}`} checked={selected.has(d.id)} onChange={() => toggle(d.id)} />
                    </td>
                    <td>
                      <Link href={`/devices/${d.id}`}>
                        <strong>{d.name}</strong>
                      </Link>
                      {d.opsReader && (
                        <span className="badge blue" style={{ marginLeft: 6 }} title="Leitura do SSW ligada">
                          SSW
                        </span>
                      )}
                      <div className="muted small">
                        {modelOf(d)} · {d.serial ?? "sem serial"}
                      </div>
                      <div className="show-sm dev-mobile">
                        {d.loggedUser && <span className="mono">{d.loggedUser}</span>}
                        <Battery b={d.battery} online={d.online} />
                      </div>
                    </td>
                    <td>
                      <span className={`badge ${d.online ? "ok" : "off"}`}>
                        <span className="dot" /> {d.online ? "online" : "offline"}
                      </span>
                      <div className="muted small">{ago(d.lastSeenAt)}</div>
                    </td>
                    <td className="hide-sm">{d.loggedUser ? <span className="mono">{d.loggedUser}</span> : <span className="muted small">—</span>}</td>
                    <td className="hide-sm">
                      <Battery b={d.battery} online={d.online} />
                    </td>
                    <td className="hide-sm">
                      {d.network ? (
                        <>
                          {d.network.type === "wifi" ? <span className="mono">{d.network.ssid ?? "(rede oculta)"}</span> : networkLabel[d.network.type] ?? d.network.type}
                          <div className="muted small mono">
                            {d.network.ip ?? ""}
                            {d.network.type === "wifi" && d.network.rssi !== null ? ` · ${d.network.rssi} dBm` : ""}
                          </div>
                          {d.network.mac && <div className="muted small mono">MAC {d.network.mac}</div>}
                        </>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td className="hide-sm">
                      {d.uptimeMs === null ? (
                        <span className="muted">—</span>
                      ) : (
                        <>
                          <span className="mono" suppressHydrationWarning>
                            {uptime(d.uptimeMs + (d.online ? msSince(d.infoUpdatedAt) : 0))}
                          </span>
                          {!d.online && <div className="muted small">no último contato</div>}
                        </>
                      )}
                    </td>
                    <td className="hide-sm">
                      <span className="dev-kiosk">
                        {mode} <span className="muted">/</span> {d.profileName ?? <span className="muted">sem perfil</span>}
                      </span>
                      {d.configStatus === "error" && (
                        <div>
                          <span className="badge danger" title={hint}>
                            <span className="dot" /> {label}
                          </span>
                        </div>
                      )}
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
      )}
    </div>
  );
}
