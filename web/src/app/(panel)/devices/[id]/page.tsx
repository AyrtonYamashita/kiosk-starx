import Link from "next/link";
import { notFound } from "next/navigation";
import { AutoRefresh } from "@/components/AutoRefresh";
import { LiquidGlassDefs } from "@/components/brand/LiquidGlass";
import { api, ApiError, type CatalogApp, type Command, type DeviceDetail, type Profile, type RepoApp, type Screenshot } from "@/lib/api";
import { ago, bytes, dateTime, defaultDeviceName, kioskModeLabel, networkLabel, uptime } from "@/lib/format";
import { DeleteDevice, IdentityForm, OpsReaderToggle } from "./DeviceForms";
import { MoreInfo } from "./MoreInfo";
import { AppsTable } from "./AppsTable";
import { AppForms, CommandButtons, ManagedAppsStatus } from "./DeviceCommands";
import { DeviceConfig } from "./DeviceConfig";
import { LocationCard } from "./DeviceLocation";
import { DeviceMapLazy } from "./DeviceMapLazy";
import { UnderlineTabs } from "@/components/UnderlineTabs";

export const dynamic = "force-dynamic";

/*
  Página do dispositivo (identidade visual Starx, ver starx-kiosk-brand/BRAND.md § Página do dispositivo):
  mapa da última posição como fundo da tela toda, cards de vidro líquido por cima (raio 28, padding 16, controles 12).
  Esquerda: resumo + abas (Comandos · Leitura SSW · Apps · JSON). Direita: Aparelho + Configuração pelo painel.
  Centro livre: o marcador e o cartão da posição. Sem localização, sem mapa (fica o fundo Bubble).
*/
export default async function DevicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // tudo em paralelo: cada ida à API custa uma viagem até a VPS
  let d: DeviceDetail;
  let profiles: Profile[], commands: Command[], screenshots: Screenshot[], repo: RepoApp[], catalog: CatalogApp[];
  try {
    const [detail, p, c, r, cat] = await Promise.all([
      api<DeviceDetail>(`/v1/admin/devices/${id}`),
      api<{ profiles: Profile[] }>("/v1/admin/profiles"),
      api<{ commands: Command[]; screenshots: Screenshot[] }>(`/v1/admin/devices/${id}/commands`),
      api<{ apps: RepoApp[] }>("/v1/admin/apps"),
      api<{ apps: CatalogApp[] }>("/v1/admin/apps-catalog"),
    ]);
    d = detail;
    profiles = p.profiles;
    ({ commands, screenshots } = c);
    repo = r.apps;
    catalog = cat.apps;
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
  const hw = d.info?.hardware ?? {};
  const bat = d.info?.battery ?? {};
  const net = d.info?.network ?? {};
  const st = d.info?.storage ?? {};
  const mem = d.info?.memory ?? {};
  const app = d.info?.app ?? {};
  const k = d.config?.kiosk;
  const loc = d.info?.location ?? null;
  const locEnabled = d.config?.security?.reportLocation !== false;
  const hasMap = locEnabled && !!loc && typeof loc.lat === "number";
  const siteMode = k?.enabled && k.mode === "web";

  const netValue =
    net.type === "wifi" && net.wifi ? `Wi-Fi · ${net.wifi.rssi} dBm` : (networkLabel[net.type] ?? net.type ?? "—");

  const tabs = [
    {
      value: "comandos",
      label: "Comandos",
      content: <CommandButtons device={d} screenshots={screenshots} />,
    },
    {
      value: "ssw",
      label: "Leitura SSW",
      content: (
        <div className="stack" style={{ gap: 10 }}>
          <span className="muted small">
            Ligada, o app lê a tela do SSW neste coletor (quem está logado, a descarga e as bipagens) e manda para o{" "}
            <Link href={d.opsReader ? `/operations/${d.id}` : "/operations"}>Acompanhamento</Link>. Só observa: não clica nem digita nada. Sem escolha
            aqui, vale a chave geral, no fim da página de Aparelhos.
          </span>
          <OpsReaderToggle id={d.id} on={d.opsReader} choice={d.opsReaderChoice} all={d.opsReaderAll} appVersionCode={d.appVersionCode} />
        </div>
      ),
    },
    // kiosk em modo site: sem a aba de apps instalados
    ...(siteMode
      ? []
      : [
          {
            value: "apps",
            label: "Apps",
            content: (
              <div className="stack" style={{ gap: 10 }}>
                <AppsTable apps={d.apps} />
                <span className="muted small">Lista enviada {ago(d.appsUpdatedAt)}.</span>
                <details>
                  <summary className="small">Instalar ou remover app</summary>
                  <div style={{ marginTop: 8 }}>
                    <AppForms device={d} repo={repo} />
                  </div>
                </details>
              </div>
            ),
          },
        ]),
    ...(d.config
      ? [
          {
            value: "json",
            label: "JSON",
            content: (
              <div className="stack" style={{ gap: 8 }}>
                <span className="muted small">Configuração atual no aparelho, como ele informou no último contato.</span>
                <pre className="json mono">{JSON.stringify(d.config, null, 2)}</pre>
              </div>
            ),
          },
        ]
      : []),
  ];

  return (
    <div className={`device-page wide${hasMap ? " has-map" : ""}`}>
      <AutoRefresh seconds={commands.some((c) => c.status === "pending" || c.status === "sent") ? 2 : 15} />
      <LiquidGlassDefs />
      {hasMap && <DeviceMapLazy lat={loc.lat} lon={loc.lon} accuracyM={loc.accuracyM} />}

      <div className="device-col device-left">
        <section className="liquid-glass device-card device-head">
          <div className="row" style={{ gap: 8 }}>
            <Link href="/" className="device-back small" transitionTypes={["nav-back"]}>
              ← Aparelhos
            </Link>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <h1 className="device-name">{d.name}</h1>
            {d.online ? (
              <span className="badge ok">
                <span className="dot" /> online
              </span>
            ) : (
              <span className="badge off">
                <span className="dot" /> offline
              </span>
            )}
          </div>
          <span className="muted small" title={dateTime(d.lastSeenAt)}>
            último contato {ago(d.lastSeenAt)}
          </span>
          <dl className="device-stats">
            <div>
              <dt>Bateria</dt>
              <dd className={bat.level !== undefined && bat.level <= 15 && !bat.charging ? "bad" : undefined}>
                {bat.level ?? "—"}%{bat.charging ? " · carregando" : ""}
              </dd>
            </div>
            <div>
              <dt>Rede</dt>
              <dd>{netValue}</dd>
            </div>
            <div>
              <dt>Armazenamento</dt>
              <dd>{bytes(st.freeBytes)} livres</dd>
            </div>
            <div>
              <dt>Memória</dt>
              <dd>{bytes(mem.availBytes)} livres</dd>
            </div>
          </dl>
        </section>

        <section className="liquid-glass device-card">
          <UnderlineTabs tabs={tabs} label="Seções do aparelho" />
        </section>

        <section className="liquid-glass device-card device-loc-card" aria-label="Última posição">
          <h2>Coordenadas</h2>
          <LocationCard location={loc} enabled={locEnabled} />
        </section>

        <section className="liquid-glass device-card">
          <h2>Identidade</h2>
          <IdentityForm id={d.id} name={d.name} fallback={defaultDeviceName(d.model, d.serial)} />
          <div className="device-danger">
            <DeleteDevice id={d.id} name={d.name} />
          </div>
        </section>
      </div>

      <div className="device-col device-right">
        <section className="liquid-glass device-card">
          <h2>Aparelho</h2>
          <dl className="kv">
            <dt>Modelo</dt>
            <dd>{[d.manufacturer, d.model].filter(Boolean).join(" ") || "—"}</dd>
            <dt>Serial</dt>
            <dd className="mono">{d.serial ?? "—"}</dd>
            <dt>Android</dt>
            <dd>
              {hw.androidVersion ?? "?"} (SDK {hw.sdkInt ?? "?"})
            </dd>
            <dt>Patch</dt>
            <dd>{hw.securityPatch ?? "—"}</dd>
            <dt>Ligado há</dt>
            <dd>{uptime(d.info?.uptimeMs)}</dd>
            <dt>App StarX</dt>
            <dd>
              <span className="mono">{d.appVersion ?? "—"}</span>{" "}
              {app.isDeviceOwner === false && (
                <span className="badge danger">
                  <span className="dot" /> não é Device Owner
                </span>
              )}
            </dd>
            <dt>Kiosk</dt>
            <dd>
              {!k ? "—" : k.enabled ? kioskModeLabel[k.mode] ?? k.mode : "desligado"}
              {k?.enabled && k.mode === "app" && <span className="mono"> · {k.app ?? "—"}</span>}
              {k?.enabled && k.mode === "web" && <div className="mono small">{k.web?.url || "—"}</div>}
              {k?.enabled && k.mode === "apps" && <div className="mono small">{(k.apps ?? []).join(", ") || "—"}</div>}
              {k?.enabled && app.kioskActive === false && (
                <span className="badge warn">
                  <span className="dot" /> não aplicado
                </span>
              )}
            </dd>
            <dt>Usuário no SSW</dt>
            <dd>
              {d.sswUser ? <span className="mono">{d.sswUser}</span> : <span className="muted">{d.opsReader ? "ninguém no SSW" : "leitura desligada"}</span>}
            </dd>
            <dt>Cadastro</dt>
            <dd>
              {dateTime(d.enrolledAt)}
              {d.enrollmentName ? ` · ${d.enrollmentName}` : ""}
            </dd>
          </dl>
          <MoreInfo title="Rede, IMEI e configuração">
            <dl className="kv">
              <dt>IMEI</dt>
              <dd className="mono">{(hw.imeis ?? []).join(", ") || "—"}</dd>
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
              <dt>Bateria</dt>
              <dd>{bat.temperatureC ? `${String(bat.temperatureC).replace(".", ",")} °C` : "—"}</dd>
              <dt>Configuração</dt>
              <dd>
                {d.configRevision !== null ? `rev ${d.configRevision}` : "—"}
                {d.configSource ? ` · alterada por ${d.configSource}` : ""}
              </dd>
            </dl>
          </MoreInfo>
        </section>

        <section className="liquid-glass device-card device-config">
          <h2>Configuração pelo painel</h2>
          <DeviceConfig device={d} profiles={profiles.map((p) => ({ id: p.id, name: p.name, config: p.config }))} catalog={catalog}>
            {d.managedApps.length > 0 && (
              <div className="stack" style={{ gap: 8 }}>
                <strong className="small">Apps gerenciados pelo perfil</strong>
                <ManagedAppsStatus device={d} repo={repo} />
              </div>
            )}
          </DeviceConfig>
        </section>
      </div>
    </div>
  );
}
