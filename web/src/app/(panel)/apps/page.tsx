import Link from "next/link";
import { api, type KioskRelease as KR, type RepoApp } from "@/lib/api";
import { bytes, dateTime } from "@/lib/format";
import { DeleteApp, DeleteVersion, RenameApp } from "./AppForms";
import { KioskRelease } from "./KioskRelease";
import { UploadApk } from "./UploadApk";

export const dynamic = "force-dynamic";

export default async function AppsPage() {
  const [{ apps, maxApkMb }, kiosk] = await Promise.all([
    api<{ apps: RepoApp[]; maxApkMb: number }>("/v1/admin/apps"),
    api<KR>("/v1/admin/kiosk-release"),
  ]);
  return (
    <div className="stack">
      <h1>Apps</h1>
      <p className="muted" style={{ margin: 0 }}>
        Repositório de APKs do painel. Inclua um app num <Link href="/profiles">perfil</Link> para que os aparelhos dele o instalem e mantenham na versão mais nova, ou
        instale avulso pela página do aparelho.
      </p>

      <section className="card stack">
        <h2>App do kiosk (StarX Kiosk)</h2>
        <KioskRelease data={kiosk} />
      </section>

      <section className="card stack">
        <h2>Enviar APK ao repositório</h2>
        <UploadApk maxApkMb={maxApkMb} />
      </section>

      {apps.length === 0 && <div className="card muted">Nenhum app no repositório ainda.</div>}

      {apps.map((a) => (
        <section key={a.packageName} className="card stack">
          <div className="row">
            <h2 style={{ margin: 0 }}>{a.label}</h2>
            <span className="mono small muted">{a.packageName}</span>
          </div>
          <div className="row small">
            <span>
              Instalado em <strong>{a.installedDevices}</strong> aparelho(s), <strong>{a.upToDateDevices}</strong> na versão mais nova.
            </span>
            <span className="muted">
              Perfis:{" "}
              {a.profiles.length
                ? a.profiles.map((p, i) => (
                    <span key={p.id}>
                      {i > 0 && ", "}
                      <Link href={`/profiles/${p.id}`}>{p.name}</Link>
                    </span>
                  ))
                : "nenhum"}
            </span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Versão</th>
                  <th>Tamanho</th>
                  <th className="hide-sm">Android mín.</th>
                  <th className="hide-sm">Enviado</th>
                  <th>Aparelhos</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {a.versions.map((v, i) => (
                  <tr key={v.id}>
                    <td>
                      {v.versionName ?? "—"} <span className="muted">({v.versionCode})</span> {i === 0 && <span className="badge ok">mais nova</span>}
                    </td>
                    <td className="small">{v.sizeBytes < 1_048_576 ? `${Math.max(1, Math.round(v.sizeBytes / 1024))} KB` : bytes(v.sizeBytes)}</td>
                    <td className="hide-sm small">{v.minSdk ? `SDK ${v.minSdk}` : "—"}</td>
                    <td className="hide-sm small">
                      {dateTime(v.uploadedAt)}
                      <div className="muted">{v.uploadedBy ?? ""}</div>
                    </td>
                    <td className="small">{v.devices}</td>
                    <td>
                      <DeleteVersion packageName={a.packageName} versionCode={v.versionCode} label={a.label} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <details>
            <summary className="small">Administrar</summary>
            <div className="stack" style={{ marginTop: 8 }}>
              <RenameApp packageName={a.packageName} label={a.label} />
              <span className="muted small mono">assinatura SHA-256 {a.signingCertSha256}</span>
              <DeleteApp packageName={a.packageName} label={a.label} />
            </div>
          </details>
        </section>
      ))}
    </div>
  );
}
