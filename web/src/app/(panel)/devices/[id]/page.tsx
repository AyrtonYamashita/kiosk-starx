import Link from "next/link";
import { notFound } from "next/navigation";
import { AutoRefresh } from "@/components/AutoRefresh";
import { api, ApiError, type Command, type DeviceDetail, type Profile, type RepoApp, type Screenshot } from "@/lib/api";
import { ago, bytes, dateTime, kioskModeLabel, networkLabel, uptime } from "@/lib/format";
import { DeleteDevice, RenameDevice } from "./DeviceForms";
import { AppsTable } from "./AppsTable";
import { DeviceCommands, ManagedAppsStatus } from "./DeviceCommands";
import { DeviceConfig } from "./DeviceConfig";

export const dynamic = "force-dynamic";

export default async function DevicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let d: DeviceDetail;
  try {
    d = await api<DeviceDetail>(`/v1/admin/devices/${id}`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
  const [{ profiles }, { commands, screenshots }, { apps: repo }] = await Promise.all([
    api<{ profiles: Profile[] }>("/v1/admin/profiles"),
    api<{ commands: Command[]; screenshots: Screenshot[] }>(`/v1/admin/devices/${id}/commands`),
    api<{ apps: RepoApp[] }>("/v1/admin/apps"),
  ]);
  const hw = d.info?.hardware ?? {};
  const bat = d.info?.battery ?? {};
  const net = d.info?.network ?? {};
  const st = d.info?.storage ?? {};
  const mem = d.info?.memory ?? {};
  const app = d.info?.app ?? {};
  const k = d.config?.kiosk;

  return (
    <div className="stack">
      <AutoRefresh seconds={10} />
      <div className="row">
        <Link href="/" className="muted">
          ← Aparelhos
        </Link>
      </div>
      <div className="row">
        <h1 style={{ margin: 0 }}>{d.name}</h1>
        {d.online ? (
          <span className="badge ok">
            <span className="dot" /> online
          </span>
        ) : (
          <span className="badge off">
            <span className="dot" /> offline
          </span>
        )}
        <span className="muted small">último contato {ago(d.lastSeenAt)} ({dateTime(d.lastSeenAt)})</span>
      </div>

      <div className="grid">
        <section className="card">
          <h2>Aparelho</h2>
          <dl className="kv">
            <dt>Modelo</dt>
            <dd>{[d.manufacturer, d.model].filter(Boolean).join(" ") || "—"}</dd>
            <dt>Serial</dt>
            <dd className="mono">{d.serial ?? "—"}</dd>
            <dt>IMEI</dt>
            <dd className="mono">{(hw.imeis ?? []).join(", ") || "—"}</dd>
            <dt>Android</dt>
            <dd>
              {hw.androidVersion ?? "?"} (SDK {hw.sdkInt ?? "?"})
            </dd>
            <dt>Patch de segurança</dt>
            <dd>{hw.securityPatch ?? "—"}</dd>
            <dt>Ligado há</dt>
            <dd>{uptime(d.info?.uptimeMs)}</dd>
          </dl>
        </section>

        <section className="card">
          <h2>Estado</h2>
          <dl className="kv">
            <dt>Bateria</dt>
            <dd>
              {bat.level ?? "—"}%{bat.charging ? " (carregando)" : ""}
              {bat.temperatureC ? ` · ${String(bat.temperatureC).replace(".", ",")} °C` : ""}
            </dd>
            <dt>Armazenamento</dt>
            <dd>
              {bytes(st.freeBytes)} livres de {bytes(st.totalBytes)}
            </dd>
            <dt>Memória</dt>
            <dd>
              {bytes(mem.availBytes)} livres de {bytes(mem.totalBytes)}
            </dd>
            <dt>Tela</dt>
            <dd>{d.info?.screenOn === undefined ? "—" : d.info.screenOn ? "ligada" : "desligada"}</dd>
          </dl>
        </section>

        <section className="card">
          <h2>Rede</h2>
          <dl className="kv">
            <dt>Tipo</dt>
            <dd>{networkLabel[net.type] ?? net.type ?? "—"}</dd>
            {net.wifi && (
              <>
                <dt>Wi-Fi</dt>
                <dd>
                  {net.wifi.ssid ?? "(SSID oculto)"} · {net.wifi.rssi} dBm · {net.wifi.frequencyMhz} MHz
                </dd>
              </>
            )}
            <dt>IP do aparelho</dt>
            <dd className="mono">{(net.ipAddresses ?? []).join(", ") || "—"}</dd>
            <dt>MAC Wi-Fi</dt>
            <dd className="mono">{net.wifiMac ?? "—"}</dd>
            <dt>IP público</dt>
            <dd className="mono">{d.lastIp ?? "—"}</dd>
          </dl>
        </section>

        <section className="card">
          <h2>Kiosk</h2>
          <dl className="kv">
            <dt>Usuário logado</dt>
            <dd>
              {d.info?.session?.user ? <span className="mono">{d.info.session.user}</span> : <span className="muted">— (integração futura com o site)</span>}
            </dd>
            <dt>App StarX</dt>
            <dd>
              {d.appVersion ?? "—"} {app.isDeviceOwner === false && <span className="badge danger">não é Device Owner</span>}
            </dd>
            <dt>Kiosk</dt>
            <dd>
              {!k ? "—" : k.enabled ? kioskModeLabel[k.mode] ?? k.mode : "desligado"}
              {k?.enabled && app.kioskActive === false && <span className="badge warn"> não aplicado</span>}
            </dd>
            {k?.enabled && k.mode === "app" && (
              <>
                <dt>App</dt>
                <dd className="mono">{k.app ?? "—"}</dd>
              </>
            )}
            {k?.enabled && k.mode === "apps" && (
              <>
                <dt>Grade</dt>
                <dd className="mono small">{(k.apps ?? []).join(", ") || "—"}</dd>
              </>
            )}
            {k?.enabled && k.mode === "web" && (
              <>
                <dt>Site</dt>
                <dd className="mono small">{k.web?.url || "—"}</dd>
              </>
            )}
            <dt>Configuração</dt>
            <dd>
              {d.configRevision !== null ? `rev ${d.configRevision}` : "—"}
              {d.configSource ? ` · alterada por ${d.configSource}` : ""}
            </dd>
            <dt>Cadastro</dt>
            <dd>
              {dateTime(d.enrolledAt)}
              {d.enrollmentName ? ` · ${d.enrollmentName}` : ""}
            </dd>
          </dl>
        </section>
      </div>

      <section className="card stack">
        <h2>Comandos</h2>
        <DeviceCommands device={d} commands={commands} screenshots={screenshots} repo={repo} />
      </section>

      <section className="card stack">
        <h2>Configuração pelo painel</h2>
        <DeviceConfig device={d} profiles={profiles.map((p) => ({ id: p.id, name: p.name }))} />
      </section>

      <section className="card stack">
        <h2>Apps gerenciados pelo perfil</h2>
        <ManagedAppsStatus device={d} repo={repo} />
      </section>

      <section className="card stack">
        <h2>Apps instalados ({d.apps.length})</h2>
        <AppsTable apps={d.apps} />
        <span className="muted small">Lista enviada {ago(d.appsUpdatedAt)}.</span>
      </section>

      {d.config && (
        <section className="card stack">
          <details>
            <summary>
              <strong>Configuração atual no aparelho (JSON)</strong> <span className="muted small">— como o aparelho informou no último contato</span>
            </summary>
            <pre className="json mono" style={{ marginTop: 12 }}>
              {JSON.stringify(d.config, null, 2)}
            </pre>
          </details>
        </section>
      )}

      <section className="card stack">
        <h2>Administração</h2>
        <RenameDevice id={d.id} name={d.name} />
        <DeleteDevice id={d.id} name={d.name} />
      </section>
    </div>
  );
}
