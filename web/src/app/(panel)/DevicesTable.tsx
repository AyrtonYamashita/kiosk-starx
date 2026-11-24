"use client";

import { useActionToast } from "@/components/Toasts";
import { useConfirm } from "@/components/ConfirmDialog";
import { FilterToggle } from "@/components/FilterToggle";
import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { bulkAssignProfile, sendCommand } from "@/lib/actions";
import type { DeviceSummary, Profile } from "@/lib/api";
import { ago, configStatusLabel, kioskModeLabel, networkLabel, uptime } from "@/lib/format";

/** Bateria com a % dentro, preenchida até o nível e na cor da faixa. Offline não mostra (o dado é velho). */
function Battery({ b, online }: { b: DeviceSummary["battery"]; online: boolean }) {
  if (!online || !b || b.level === null || b.level === undefined) return <span className="muted">—</span>;
  const tone = b.level <= 15 && !b.charging ? "bad" : b.level <= 30 && !b.charging ? "warn" : "good";
  const label = `${b.level}%${b.charging ? ", carregando" : b.level <= 15 ? ", bateria baixa" : ""}`;
  return (
    <span className={`batt ${tone}`} title={`Bateria ${label}`} role="img" aria-label={`Bateria ${label}`}>
      <span className="batt-fill" style={{ width: `${Math.max(0, Math.min(100, b.level))}%` }} aria-hidden />
      <span className="batt-n" aria-hidden>
        {b.level}%
      </span>
    </span>
  );
}

function BulkCommand({ ids, repo }: { ids: string[]; repo: { packageName: string; label: string }[] }) {
  const ask = useConfirm();
  const [state, action, pending] = useActionState(sendCommand, undefined);
  useActionToast(state);
  const [type, setType] = useState("");
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (type === "reboot")
          ask.submit(e, { title: `Reiniciar ${ids.length} aparelho(s)?`, message: "Os aparelhos selecionados reiniciam na hora.", confirmLabel: "Reiniciar", danger: true });
      }}
      className="row"
    >
      {ids.map((id) => (
        <input key={id} type="hidden" name="deviceId" value={id} />
      ))}
      <select name="type" required value={type} onChange={(e) => setType(e.target.value)} style={{ width: "auto", minWidth: "min(100%, 200px)", maxWidth: "100%" }}>
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
      {type === "message" && <input name="text" required maxLength={1000} placeholder="Mensagem (fica na tela até tocarem em OK)" style={{ width: "auto", minWidth: "min(100%, 280px)", maxWidth: "100%" }} />}
      {type === "install_app" && (
        <select name="app" required defaultValue="" style={{ width: "auto", minWidth: "min(100%, 200px)", maxWidth: "100%" }}>
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

type Group = "status" | "user" | "profile" | "model";
type Filters = { q: string } & Record<Group, string[]>;
const DEFAULTS: Filters = { q: "", status: ["online"], user: [], profile: [], model: [] };
const NONE = "__none__";

function keyOf(g: Group, d: DeviceSummary): string {
  if (g === "status") return d.online ? "online" : "offline";
  if (g === "user") return d.loggedUser ?? NONE;
  if (g === "profile") return d.profileId ?? NONE;
  return modelOf(d);
}

/** Grupo de checkboxes; nada marcado = todos. Cada opção mostra quantos aparelhos tem. */
function CheckGroup({ title, options, value, onChange }: { title: string; options: { key: string; label: string; count: number }[]; value: string[]; onChange: (v: string[]) => void }) {
  if (options.length === 0) return null;
  return (
    <fieldset className="dev-group">
      <legend className="section-label">{title}</legend>
      {options.map((o) => (
        <label key={o.key} className="check-label dev-check">
          <input
            type="checkbox"
            checked={value.includes(o.key)}
            onChange={(e) => onChange(e.target.checked ? [...value, o.key] : value.filter((v) => v !== o.key))}
          />
          <span className="dev-check-label">{o.label}</span>
          <span className="muted small">{o.count}</span>
        </label>
      ))}
    </fieldset>
  );
}

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
  // celular: filtros recolhidos atrás do botão "Filtros" (no desktop ficam sempre abertos)
  const [filtersOpen, setFiltersOpen] = useState(false);
  const set = (patch: Partial<Filters>) => setF((cur) => ({ ...cur, ...patch }));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [state, action, pending] = useActionState(bulkAssignProfile, undefined);
  useActionToast(state);

  const groups = useMemo(() => {
    const count = (g: Group) => {
      const m = new Map<string, number>();
      devices.forEach((d) => m.set(keyOf(g, d), (m.get(keyOf(g, d)) ?? 0) + 1));
      return m;
    };
    const byName = (a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label, "pt-BR");
    const st = count("status");
    const us = count("user");
    const pr = count("profile");
    const mo = count("model");
    const profileName = new Map(profiles.map((p) => [p.id, p.name]));
    return {
      status: [
        { key: "online", label: "Online", count: st.get("online") ?? 0 },
        { key: "offline", label: "Offline", count: st.get("offline") ?? 0 },
      ],
      user: [
        ...[...us].filter(([k]) => k !== NONE).map(([k, n]) => ({ key: k, label: k, count: n })).sort(byName),
        ...(us.has(NONE) ? [{ key: NONE, label: "Sem usuário", count: us.get(NONE)! }] : []),
      ],
      profile: [
        ...[...pr].filter(([k]) => k !== NONE).map(([k, n]) => ({ key: k, label: profileName.get(k) ?? "perfil removido", count: n })).sort(byName),
        ...(pr.has(NONE) ? [{ key: NONE, label: "Sem perfil", count: pr.get(NONE)! }] : []),
      ],
      model: [...mo].map(([k, n]) => ({ key: k, label: k, count: n })).sort(byName),
    };
  }, [devices, profiles]);

  const list = useMemo(() => {
    const q = f.q.trim().toLowerCase();
    const pass = (g: Group, d: DeviceSummary) => f[g].length === 0 || f[g].includes(keyOf(g, d));
    return devices.filter((d) => pass("status", d) && pass("user", d) && pass("profile", d) && pass("model", d) && (!q || haystack(d).includes(q)));
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
    <div className="dev-layout">
      <aside className="dev-filters" id="dev-filters" aria-label="Filtros" data-open={filtersOpen}>
        <label className="dev-search">
          <Search size={16} strokeWidth={1.75} aria-hidden />
          <input type="search" value={f.q} onChange={(e) => set({ q: e.target.value })} placeholder="Buscar" title="Série, modelo, MAC, IP ou rede" aria-label="Buscar por série, modelo, MAC, IP ou rede" />
        </label>
        <FilterToggle
          open={filtersOpen}
          onToggle={() => setFiltersOpen((o) => !o)}
          count={f.status.length + f.user.length + f.profile.length + f.model.length}
          controls="dev-filters"
        />
        <CheckGroup title="Status" options={groups.status} value={f.status} onChange={(v) => set({ status: v })} />
        <CheckGroup title="Usuário no SSW" options={groups.user} value={f.user} onChange={(v) => set({ user: v })} />
        <CheckGroup title="Perfil" options={groups.profile} value={f.profile} onChange={(v) => set({ profile: v })} />
        <CheckGroup title="Modelo" options={groups.model} value={f.model} onChange={(v) => set({ model: v })} />
        <div className="row small" style={{ gap: 8 }}>
          <span className="muted">
            {list.length} de {devices.length}
          </span>
          {changed && (
            <button type="button" className="link-button" onClick={() => setF(DEFAULTS)}>
              limpar filtros
            </button>
          )}
        </div>
      </aside>

      <div className="stack dev-main">
      {selected.size > 0 && (
        <div className="card stack" style={{ padding: "10px 14px", gap: 10 }}>
          <form action={action} className="row">
            {[...selected].map((id) => (
              <input key={id} type="hidden" name="deviceId" value={id} />
            ))}
            <strong>{selected.size} selecionado(s)</strong>
            <select name="profileId" required defaultValue="" style={{ width: "auto", minWidth: "min(100%, 220px)", maxWidth: "100%" }}>
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
        <div className="card list-card">
          <div className="list-scroll">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 32 }}>
                    <label className="check-hit">
                      <input
                        type="checkbox"
                        aria-label="Selecionar todos os exibidos"
                        checked={all}
                        onChange={() => setSelected(all ? new Set() : new Set(list.map((d) => d.id)))}
                      />
                    </label>
                  </th>
                  <th>Aparelho</th>
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
                        <label className="check-hit">
                          <input type="checkbox" aria-label={`Selecionar ${d.name}`} checked={selected.has(d.id)} onChange={() => toggle(d.id)} />
                        </label>
                      </td>
                      <td>
                        <span className="dev-name">
                          <span
                            className={`dot ${d.online ? "good" : "off"}`}
                            role="img"
                            aria-label={d.online ? "online" : "offline"}
                            title={`${d.online ? "online" : "offline"} · último contato ${ago(d.lastSeenAt)}`}
                          />
                          <Link href={`/devices/${d.id}`}>
                            <strong>{d.name}</strong>
                          </Link>
                        </span>
                        <div className="muted small">
                          {modelOf(d)} · {d.serial ?? "sem serial"}
                        </div>
                        <div className="show-sm dev-mobile">
                          {d.loggedUser && <span className="mono">{d.loggedUser}</span>}
                          <Battery b={d.battery} online={d.online} />
                        </div>
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
                            {d.network.mac && <div className="muted small mono">{d.network.mac}</div>}
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
        </div>
      )}
      </div>
    </div>
  );
}
