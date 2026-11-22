"use client";

import { Toggle } from "@/components/Toggle";
import { useMemo, useState } from "react";
import type { CatalogApp } from "@/lib/api";
import type { Json } from "@/lib/api";

/**
 * Editor da configuração do kiosk (mesmo formato do app). Gera um JSON completo no campo oculto `name`.
 * O PIN nunca chega aqui: o servidor manda "<definido>" no lugar do hash.
 */

type Cfg = Record<string, Json>;
type PinMode = "device" | "keep" | "set" | "none";

const DEFAULTS: Cfg = {
  kiosk: { enabled: true, mode: "apps", app: null, apps: [], relaunchDelaySec: 3, web: { url: "", reloadOnErrorSec: 15, inactivityReturnSec: 0, allowZoom: true, reloadButton: false, idleLogoutMin: 2 } },
  display: {
    keepScreenOn: true,
    brightness: null,
    dimAfterSec: 0,
    lowBatteryPercent: 15,
    lowBatteryMessage: "Troque a bateria antes de continuar a operação.",
    orientation: "auto",
    showStatusBar: false,
  },
  appearance: { title: "", backgroundColor: "#070E1A", textColor: "#FFFFFF", columns: 4 },
  security: {
    exitCorner: "bottom_right",
    exitTaps: 5,
    allowNotifications: false,
    allowPowerMenu: true,
    disableLockScreen: true,
    blockFactoryReset: true,
    blockSafeBoot: true,
    blockUsbFileTransfer: false,
    blockDebugging: false,
    systemSettingsShortcuts: true,
    reportLocation: true,
  },
};

function deepMerge(base: Cfg, over: Cfg): Cfg {
  const out: Cfg = structuredClone(base);
  for (const [k, v] of Object.entries(over ?? {})) {
    if (v && typeof v === "object" && !Array.isArray(v) && out[k] && typeof out[k] === "object" && !Array.isArray(out[k])) out[k] = deepMerge(out[k], v);
    else out[k] = v;
  }
  return out;
}

function setPath(obj: Cfg, path: string, value: unknown): Cfg {
  const copy = structuredClone(obj);
  const keys = path.split(".");
  let cur = copy;
  for (const k of keys.slice(0, -1)) cur = cur[k] ??= {};
  cur[keys[keys.length - 1]] = value;
  return copy;
}

function initialPinMode(cfg: Cfg | null): PinMode {
  const sec = cfg?.security;
  if (!sec || !("pinHash" in sec)) return "device";
  if (sec.pinHash === null) return "none";
  return "keep";
}

/** Configuração editada → JSON enviado ao servidor (o PIN conforme o modo escolhido). */
function output(cfg: Cfg, pinMode: PinMode, pin: string): Cfg {
  const out = structuredClone(cfg);
  out.schema = 1;
  delete out.security.pin;
  delete out.security.pinHash;
  if (pinMode === "keep") out.security.pinHash = "<definido>";
  if (pinMode === "none") out.security.pinHash = null;
  if (pinMode === "set") out.security.pin = pin;
  return out;
}

// ---------------------------------------------------------------- ajustes de um aparelho (só o que difere do perfil)

const isObj = (v: unknown): v is Cfg => !!v && typeof v === "object" && !Array.isArray(v);

/** Folhas de `cur` diferentes de `base` (listas comparadas inteiras, como no merge do app). */
function diff(cur: unknown, base: unknown): unknown {
  if (isObj(cur) && isObj(base)) {
    const out: Cfg = {};
    for (const k of new Set([...Object.keys(cur), ...Object.keys(base)])) {
      if (!(k in cur)) continue;
      const d = diff(cur[k], base[k]);
      if (d !== undefined) out[k] = d;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return JSON.stringify(cur) === JSON.stringify(base) ? undefined : cur;
}

function paths(obj: Cfg, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) => (isObj(v) ? paths(v, `${prefix}${k}.`) : [`${prefix}${k}`]));
}

function withoutPin(cfg: Cfg): Cfg {
  const c = structuredClone(cfg);
  delete c.schema;
  if (c.security) {
    delete c.security.pin;
    delete c.security.pinHash;
  }
  return c;
}

/** Nome legível de cada campo (para a lista "diferente do perfil"). */
const FIELD_LABEL: Record<string, string> = {
  "kiosk.enabled": "Kiosk ligado",
  "kiosk.mode": "Modo",
  "kiosk.app": "App único",
  "kiosk.apps": "Apps da grade",
  "kiosk.relaunchDelaySec": "Reabrir o app",
  "kiosk.web.url": "Site (URL)",
  "kiosk.web.reloadOnErrorSec": "Recarregar após erro",
  "kiosk.web.inactivityReturnSec": "Voltar à página inicial",
  "kiosk.web.idleLogoutMin": "Desconectar operador parado",
  "kiosk.web.allowZoom": "Zoom",
  "kiosk.web.reloadButton": "Botão de recarregar",
  "display.keepScreenOn": "Manter a tela ligada",
  "display.brightness": "Brilho",
  "display.dimAfterSec": "Escurecer após inatividade",
  "display.lowBatteryPercent": "Aviso de bateria fraca",
  "display.lowBatteryMessage": "Mensagem de bateria fraca",
  "display.orientation": "Orientação",
  "display.showStatusBar": "Barra de status",
  "appearance.title": "Título",
  "appearance.backgroundColor": "Cor de fundo",
  "appearance.textColor": "Cor do texto",
  "appearance.columns": "Colunas da grade",
  "security.pin": "PIN",
  "security.pinHash": "PIN",
  "security.exitCorner": "Canto do gesto",
  "security.exitTaps": "Toques no canto",
  "security.reportLocation": "Enviar localização",
};

const TABS = ["Kiosk", "Tela", "Segurança", "JSON"] as const;
type Tab = (typeof TABS)[number];

/**
 * `base` (opcional): configuração do perfil. Com ela, o editor mostra perfil + `initial` (os ajustes do aparelho) e o
 * campo oculto recebe só o que difere do perfil — mudar o site de um aparelho grava só `kiosk.web.url`.
 */
export function ConfigEditor({
  name,
  initial,
  catalog,
  hasExistingPin,
  base,
}: {
  name: string;
  initial: Cfg | null;
  catalog: CatalogApp[];
  hasExistingPin: boolean;
  base?: Cfg | null;
}) {
  const overrideMode = base !== undefined;
  const baseFull = useMemo(() => withoutPin(deepMerge(DEFAULTS, base ?? {})), [base]);
  const [cfg, setCfg] = useState<Cfg>(() => {
    const start = deepMerge(DEFAULTS, overrideMode ? deepMerge(base ?? {}, initial ?? {}) : (initial ?? {}));
    delete start.schema;
    return start;
  });
  const [pinMode, setPinMode] = useState<PinMode>(() => initialPinMode(initial));
  const [pin, setPin] = useState("");
  const [tab, setTab] = useState<Tab>("Kiosk");
  const [jsonText, setJsonText] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);

  const set = (path: string, value: unknown) => setCfg((c) => setPath(c, path, value));
  const full = useMemo(() => output(cfg, pinMode, pin), [cfg, pinMode, pin]);
  // ajustes do aparelho: só o que difere do perfil (o PIN só se for trocado/removido aqui)
  const changes = useMemo(() => {
    if (!overrideMode) return null;
    const d = (diff(withoutPin(cfg), baseFull) as Cfg | undefined) ?? {};
    if (pinMode !== "device") {
      d.security = { ...(d.security ?? {}) };
      if (pinMode === "set") d.security.pin = pin;
      if (pinMode === "none") d.security.pinHash = null;
      if (pinMode === "keep") d.security.pinHash = "<definido>";
    }
    return d;
  }, [overrideMode, cfg, baseFull, pinMode, pin]);
  const out = changes ?? full;
  const changedFields = changes ? [...new Set(paths(changes).map((p) => FIELD_LABEL[p] ?? p))] : [];
  const k = cfg.kiosk;
  const d = cfg.display;
  const a = cfg.appearance;
  const s = cfg.security;
  const labelOf = (p: string) => catalog.find((c) => c.package === p)?.label ?? p;
  const userApps = catalog.filter((c) => !c.system);

  function openTab(t: Tab) {
    if (t === "JSON") {
      const view = structuredClone(full);
      if (view.security?.pin) view.security.pin = "••••";
      setJsonText(JSON.stringify(view, null, 2));
      setJsonError(null);
    }
    setTab(t);
  }

  function applyJson() {
    try {
      const parsed = JSON.parse(jsonText);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("precisa ser um objeto JSON");
      const next = deepMerge(DEFAULTS, parsed);
      delete next.schema;
      const sec = parsed.security ?? {};
      if (typeof sec.pin === "string" && sec.pin !== "••••") {
        setPinMode("set");
        setPin(sec.pin);
      } else if (!("pinHash" in sec) && !("pin" in sec)) setPinMode("device");
      else if (sec.pinHash === null) setPinMode("none");
      else if (sec.pinHash === "<definido>") setPinMode(hasExistingPin ? "keep" : "device");
      delete next.security.pin;
      delete next.security.pinHash;
      setCfg(next);
      setJsonError(null);
      setTab("Kiosk");
    } catch (e) {
      setJsonError((e as Error).message);
    }
  }

  const check = (path: string, label: string, hint?: string) => {
    const value = path.split(".").reduce((o: Json, key) => o?.[key], cfg);
    return (
      <label className="check-label">
        <Toggle checked={!!value} onCheckedChange={(v) => set(path, v)} />
        <span>
          {label}
          {hint && <span className="muted small"> — {hint}</span>}
        </span>
      </label>
    );
  };

  return (
    <div className="stack">
      <input type="hidden" name={name} value={JSON.stringify(out)} />
      {overrideMode && changedFields.length > 0 && (
        <div className="row small" style={{ gap: 8 }}>
          <span className="muted">
            Diferente do perfil: <strong style={{ color: "var(--ink)" }}>{changedFields.join(", ")}</strong>
          </span>
          <button
            type="button"
            className="link-button"
            onClick={() => {
              setCfg(structuredClone(baseFull));
              setPinMode("device");
              setPin("");
            }}
          >
            voltar tudo ao perfil
          </button>
        </div>
      )}
      <datalist id="catalog-apps">
        {userApps.map((c) => (
          <option key={c.package} value={c.package}>
            {c.label ?? c.package}
          </option>
        ))}
      </datalist>
      <div className="segmented segmented-fill" role="tablist" aria-label="Seções da configuração">
        {TABS.map((t) => (
          <button type="button" key={t} role="tab" aria-selected={t === tab} className={t === tab ? "on" : undefined} onClick={() => openTab(t)}>
            {t}
          </button>
        ))}
      </div>

      {tab === "Kiosk" && (
        <div className="stack">
          {check("kiosk.enabled", "Kiosk ligado", "desligado, o aparelho funciona normalmente (as restrições continuam)")}
          <label>
            Modo
            <select value={k.mode} onChange={(e) => set("kiosk.mode", e.target.value)}>
              <option value="app">App único</option>
              <option value="apps">Grade de apps</option>
              <option value="web">Site</option>
            </select>
          </label>

          {k.mode === "app" && (
            <>
              <label>
                App (pacote)
                <input list="catalog-apps" value={k.app ?? ""} placeholder="com.empresa.coletor" onChange={(e) => set("kiosk.app", e.target.value.trim() || null)} />
                {k.app && <span className="muted small">{labelOf(k.app)}</span>}
              </label>
              <label>
                Reabrir o app depois de fechar (segundos)
                <input type="number" min={0} max={300} value={k.relaunchDelaySec} onChange={(e) => set("kiosk.relaunchDelaySec", Number(e.target.value))} />
              </label>
            </>
          )}

          {k.mode === "apps" && <AppsList apps={k.apps} labelOf={labelOf} onChange={(v) => set("kiosk.apps", v)} />}

          {k.mode === "web" && (
            <>
              <label>
                URL
                <input value={k.web.url} placeholder="https://…" onChange={(e) => set("kiosk.web.url", e.target.value.trim())} />
              </label>
              <div className="grid">
                <label>
                  Recarregar após erro (s, 0 = não)
                  <input type="number" min={0} max={3600} value={k.web.reloadOnErrorSec} onChange={(e) => set("kiosk.web.reloadOnErrorSec", Number(e.target.value))} />
                </label>
                <label>
                  Voltar à página inicial após inatividade (s, 0 = nunca)
                  <input type="number" min={0} max={86400} value={k.web.inactivityReturnSec} onChange={(e) => set("kiosk.web.inactivityReturnSec", Number(e.target.value))} />
                </label>
                <label>
                  Desconectar operador parado no SSW (min, 0 = nunca)
                  <input type="number" min={0} max={240} value={k.web.idleLogoutMin ?? 2} onChange={(e) => set("kiosk.web.idleLogoutMin", Number(e.target.value))} />
                </label>
              </div>
              {check("kiosk.web.allowZoom", "Permitir zoom")}
              {check("kiosk.web.reloadButton", "Botão de recarregar a página", "atalho na tela do kiosk para o operador sair de um erro")}
            </>
          )}

          <h2 style={{ marginTop: 8 }}>Aparência</h2>
          <div className="grid">
            <label>
              Título (topo da grade)
              <input value={a.title} maxLength={80} onChange={(e) => set("appearance.title", e.target.value)} />
            </label>
            <label>
              Colunas da grade
              <input type="number" min={2} max={8} value={a.columns} onChange={(e) => set("appearance.columns", Number(e.target.value))} />
            </label>
            <ColorField label="Cor de fundo" value={a.backgroundColor} onChange={(v) => set("appearance.backgroundColor", v)} />
            <ColorField label="Cor do texto" value={a.textColor} onChange={(v) => set("appearance.textColor", v)} />
          </div>
        </div>
      )}

      {tab === "Tela" && (
        <div className="stack">
          {check("display.keepScreenOn", "Manter a tela ligada", "durante o kiosk")}
          <label>
            Escurecer após inatividade (s, 0 = não escurece)
            <input type="number" min={0} max={86400} value={d.dimAfterSec ?? 0} onChange={(e) => set("display.dimAfterSec", Number(e.target.value))} style={{ maxWidth: 200 }} />
            <span className="muted small" style={{ fontWeight: 400 }}>
              Sem toque por esse tempo, o brilho cai para 1% — a tela nunca apaga (a conexão com o painel continua ativa e os comandos chegam na hora). O primeiro toque devolve o
              brilho. Ligado, a tela fica sempre ligada.
            </span>
          </label>
          <h2 style={{ marginTop: 8 }}>Bateria</h2>
          <div className="grid">
            <label>
              Avisar bateria fraca em (%, 0 = sem aviso)
              <input type="number" min={0} max={50} value={d.lowBatteryPercent ?? 15} onChange={(e) => set("display.lowBatteryPercent", Number(e.target.value))} />
            </label>
            <label>
              Mensagem do aviso
              <input value={d.lowBatteryMessage ?? ""} maxLength={200} onChange={(e) => set("display.lowBatteryMessage", e.target.value)} />
            </label>
          </div>
          <span className="muted small">
            Sem carregar e com a bateria nesse nível, o aviso abre por cima de qualquer tela do coletor; repete a cada 5% a menos e fecha sozinho ao começar a carregar.
          </span>
          <label className="check-label">
            <Toggle checked={d.brightness !== null} onCheckedChange={(v) => set("display.brightness", v ? 80 : null)} />
            Brilho fixo
          </label>
          {d.brightness !== null && (
            <label>
              Brilho: {d.brightness}%
              <input type="range" min={0} max={100} value={d.brightness} onChange={(e) => set("display.brightness", Number(e.target.value))} />
            </label>
          )}
          <label>
            Orientação (grade e site)
            <select value={d.orientation} onChange={(e) => set("display.orientation", e.target.value)}>
              <option value="auto">Automática</option>
              <option value="portrait">Retrato</option>
              <option value="landscape">Paisagem</option>
            </select>
          </label>
          {check("display.showStatusBar", "Barra de status", "hora, bateria e rede visíveis no kiosk")}
        </div>
      )}

      {tab === "Segurança" && (
        <div className="stack">
          <label>
            PIN de administrador
            <select value={pinMode} onChange={(e) => setPinMode(e.target.value as PinMode)}>
              <option value="device">{overrideMode ? "Seguir o PIN do perfil" : "Não mexer no PIN dos aparelhos"}</option>
              {hasExistingPin && <option value="keep">Manter o PIN definido neste perfil</option>}
              <option value="set">{hasExistingPin ? "Trocar o PIN" : "Definir um PIN"}</option>
              <option value="none">Sem PIN (qualquer um abre a administração)</option>
            </select>
          </label>
          {pinMode === "set" && (
            <label>
              Novo PIN (4 a 32 caracteres; só números = teclado numérico)
              <input type="password" autoComplete="new-password" value={pin} minLength={4} maxLength={32} required onChange={(e) => setPin(e.target.value)} />
            </label>
          )}
          <div className="grid">
            <label>
              Canto do gesto
              <select value={s.exitCorner} onChange={(e) => set("security.exitCorner", e.target.value)}>
                <option value="top_left">Superior esquerdo</option>
                <option value="top_right">Superior direito</option>
                <option value="bottom_left">Inferior esquerdo</option>
                <option value="bottom_right">Inferior direito</option>
              </select>
            </label>
            <label>
              Toques no canto
              <input type="number" min={3} max={10} value={s.exitTaps} onChange={(e) => set("security.exitTaps", Number(e.target.value))} />
            </label>
          </div>
          <h2 style={{ marginTop: 8 }}>Durante o kiosk</h2>
          {check("security.allowNotifications", "Notificações")}
          {check("security.allowPowerMenu", "Menu do botão de energia", "desligar/reiniciar")}
          {check("security.disableLockScreen", "Desativar tela de bloqueio", "só funciona sem senha/padrão no aparelho")}
          {check("security.systemSettingsShortcuts", "Atalhos do Android na administração", "Wi-Fi, Bluetooth, Configurações")}
          {check("security.reportLocation", "Enviar a localização ao painel", "GPS/rede do Android; aparece no mapa da página do aparelho")}
          <h2 style={{ marginTop: 8 }}>Restrições do aparelho (sempre)</h2>
          {check("security.blockFactoryReset", "Bloquear reset de fábrica")}
          {check("security.blockSafeBoot", "Bloquear modo de segurança")}
          {check("security.blockUsbFileTransfer", "Bloquear transferência de arquivos por USB")}
          {check("security.blockDebugging", "Bloquear depuração USB", "corta o acesso por ADB")}
        </div>
      )}

      {tab === "JSON" && (
        <div className="stack">
          <span className="muted small">
            Mesmo formato do arquivo exportado no aparelho (docs/configuracao.md). Edite e clique em &quot;Usar este JSON&quot;; depois salve.
          </span>
          <textarea className="mono" style={{ minHeight: 360 }} value={jsonText} onChange={(e) => setJsonText(e.target.value)} spellCheck={false} />
          {jsonError && <div className="alert error">JSON inválido: {jsonError}</div>}
          <div>
            <button type="button" onClick={applyJson}>
              Usar este JSON
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label>
      {label}
      <span className="row" style={{ flexWrap: "nowrap" }}>
        <input type="color" value={value.slice(0, 7)} onChange={(e) => onChange(e.target.value.toUpperCase())} style={{ width: 48, padding: 2 }} />
        <input value={value} onChange={(e) => onChange(e.target.value.trim())} className="mono" />
      </span>
    </label>
  );
}

function AppsList({ apps, labelOf, onChange }: { apps: string[]; labelOf: (p: string) => string; onChange: (v: string[]) => void }) {
  const [adding, setAdding] = useState("");
  const add = () => {
    const p = adding.trim();
    if (p && !apps.includes(p)) onChange([...apps, p]);
    setAdding("");
  };
  const move = (i: number, dir: -1 | 1) => {
    const next = [...apps];
    [next[i], next[i + dir]] = [next[i + dir], next[i]];
    onChange(next);
  };
  return (
    <div className="stack">
      <span>Apps da grade (na ordem)</span>
      {apps.length === 0 && <span className="muted small">Nenhum app ainda.</span>}
      {apps.map((p, i) => (
        <div key={p} className="row" style={{ gap: 8 }}>
          <span style={{ flex: 1 }}>
            {labelOf(p)} <span className="muted small mono">{p}</span>
          </span>
          <button type="button" disabled={i === 0} onClick={() => move(i, -1)} title="Subir">
            ↑
          </button>
          <button type="button" disabled={i === apps.length - 1} onClick={() => move(i, 1)} title="Descer">
            ↓
          </button>
          <button type="button" className="danger" onClick={() => onChange(apps.filter((x) => x !== p))} title="Remover">
            ✕
          </button>
        </div>
      ))}
      <div className="row">
        <input
          list="catalog-apps"
          placeholder="pacote do app (a lista sugere os apps vistos nos aparelhos)"
          value={adding}
          onChange={(e) => setAdding(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          style={{ flex: 1, minWidth: 240 }}
        />
        <button type="button" onClick={add}>
          Adicionar
        </button>
      </div>
    </div>
  );
}
