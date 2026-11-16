import Link from "next/link";
import { AutoRefresh } from "@/components/AutoRefresh";
import { api, type DeviceSummary, type Profile, type RepoApp } from "@/lib/api";
import { DevicesTable } from "./DevicesTable";

export const dynamic = "force-dynamic";

export default async function DevicesPage() {
  const [{ devices }, { profiles }, { apps: repo }] = await Promise.all([
    api<{ devices: DeviceSummary[]; onlineWindowSec: number }>("/v1/admin/devices"),
    api<{ profiles: Profile[] }>("/v1/admin/profiles"),
    api<{ apps: RepoApp[] }>("/v1/admin/apps"),
  ]);
  const online = devices.filter((d) => d.online).length;
  return (
    <div className="stack wide">
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
        <DevicesTable devices={devices} profiles={profiles.map((p) => ({ id: p.id, name: p.name }))} repo={repo.map((a) => ({ packageName: a.packageName, label: a.label }))} />
      )}
    </div>
  );
}
