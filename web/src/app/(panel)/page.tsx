import Link from "next/link";
import { AutoRefresh } from "@/components/AutoRefresh";
import { api, type DeviceSummary } from "@/lib/api";
import { ago, kioskModeLabel, networkLabel } from "@/lib/format";

export const dynamic = "force-dynamic";

function Battery({ b }: { b: DeviceSummary["battery"] }) {
  if (!b || b.level === null || b.level === undefined) return <span className="muted">—</span>;
  const cls = b.charging ? "ok" : b.level <= 15 ? "danger" : b.level <= 30 ? "warn" : "off";
  return (
    <span className={`badge ${cls}`}>
      {b.level}%{b.charging ? " ⚡" : ""}
    </span>
  );
}

export default async function DevicesPage() {
  const { devices } = await api<{ devices: DeviceSummary[]; onlineWindowSec: number }>("/v1/admin/devices");
  const online = devices.filter((d) => d.online).length;
  return (
    <div className="stack">
      <AutoRefresh seconds={15} />
      <div className="row">
        <h1 style={{ margin: 0 }}>Aparelhos</h1>
        <span className="badge ok">
          <span className="dot" /> {online} online
        </span>
        <span className="badge off">{devices.length - online} offline</span>
        <span className="spacer" />
        <Link href="/enroll" className="button">
          + Cadastrar aparelho
        </Link>
      </div>

      {devices.length === 0 ? (
        <div className="card">
          Nenhum aparelho cadastrado ainda. Gere um código em <Link href="/enroll">Cadastro</Link> e use o QR (aparelho novo) ou o
          código (aparelho que já tem o app).
        </div>
      ) : (
        <div className="card table-wrap" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Aparelho</th>
                <th>Status</th>
                <th>Bateria</th>
                <th className="hide-sm">Rede</th>
                <th className="hide-sm">Kiosk</th>
                <th className="hide-sm">App</th>
              </tr>
            </thead>
            <tbody>
              {devices.map((d) => (
                <tr key={d.id}>
                  <td>
                    <Link href={`/devices/${d.id}`}>
                      <strong>{d.name}</strong>
                    </Link>
                    <div className="muted small">
                      {[d.manufacturer, d.model].filter(Boolean).join(" ")} · {d.serial ?? "sem serial"}
                    </div>
                  </td>
                  <td>
                    {d.online ? (
                      <span className="badge ok">
                        <span className="dot" /> online
                      </span>
                    ) : (
                      <span className="badge off">
                        <span className="dot" /> offline
                      </span>
                    )}
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
                        {d.network.rssi !== null && d.network.type === "wifi" ? <span className="muted small"> ({d.network.rssi} dBm)</span> : null}
                        <div className="muted small mono">{d.network.ip ?? ""}</div>
                      </>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td className="hide-sm">
                    {d.kioskEnabled ? (
                      <>
                        {kioskModeLabel[d.kioskMode ?? ""] ?? d.kioskMode}
                        {d.kioskActive === false && <div className="badge warn">não aplicado</div>}
                      </>
                    ) : d.kioskEnabled === false ? (
                      <span className="muted">desligado</span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                    {d.configRevision !== null && <div className="muted small">config rev {d.configRevision}</div>}
                  </td>
                  <td className="hide-sm">
                    {d.appVersion ?? "—"}
                    <div className="muted small">Android {d.androidVersion ?? "?"}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
