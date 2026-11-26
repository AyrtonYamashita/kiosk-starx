import Link from "next/link";
import { api, type KioskRelease as KR, type Me, type Releases, type RepoApp } from "@/lib/api";
import { bytes, dateTime } from "@/lib/format";
import { DeleteApp, DeleteVersion, RenameApp } from "./AppForms";
import { KioskVersions, PilotDevices, ReaderVersions } from "./Releases";
import { UploadApk } from "./UploadApk";

export const dynamic = "force-dynamic";

export default async function AppsPage() {
  const me = await api<Me>("/v1/admin/me");
  // usuário da plataforma: só o app do kiosk (o repositório de apps é de cada empresa)
  if (!me.tenant) {
    const [kiosk, releases] = await Promise.all([api<KR>("/v1/admin/kiosk-release"), api<Releases>("/v1/admin/releases")]);
    return (
      <div className="stack">
        <h1>Versões</h1>
        <p className="muted" style={{ margin: 0 }}>
          Conta da plataforma: o app do kiosk e o leitor do SSW valem para todas as empresas. Para ver uma empresa, entre nela em <Link href="/platform">Empresas</Link>.
        </p>

      <div className="card release-how">
        <ol>
          <li>
            <strong>Enviar</strong>
            <span className="muted small">o APK fica no servidor; nenhum coletor recebe</span>
          </li>
          <li>
            <strong>Pilotos</strong>
            <span className="muted small">só os coletores marcados como piloto recebem, em produção</span>
          </li>
          <li>
            <strong>Todos</strong>
            <span className="muted small">todos recebem; o teste acaba</span>
          </li>
        </ol>
        <span className="muted small">
          Cada passo pode ser agora ou agendado. Um coletor com carga aberta só recebe (e só recarrega a página) quando ela fechar.
        </span>
      </div>

      <section className="card stack">
        <h2>App do kiosk (StarX Kiosk)</h2>
        <KioskVersions data={releases} canPublish={me.platform} maxApkMb={kiosk.maxApkMb} autoUpdate={kiosk.autoUpdate} />
      </section>

      <section className="card stack">
        <h2>Leitor do SSW</h2>
        <ReaderVersions data={releases} canPublish={me.platform} />
      </section>

      <section className="card stack">
        <h2>Coletores piloto</h2>
        <PilotDevices data={releases} />
      </section>
      </div>
    );
  }
  const [{ apps, maxApkMb }, kiosk, releases] = await Promise.all([
    api<{ apps: RepoApp[]; maxApkMb: number }>("/v1/admin/apps"),
    api<KR>("/v1/admin/kiosk-release"),
    api<Releases>("/v1/admin/releases"),
  ]);
  return (
    <div className="stack">
      <h1>Apps</h1>
      <p className="muted" style={{ margin: 0 }}>
        Repositório de APKs do painel. Inclua um app num <Link href="/profiles">perfil</Link> para que os aparelhos dele o instalem e mantenham na versão mais nova, ou
        instale avulso pela página do aparelho.
      </p>

<div className="card release-how">
        <ol>
          <li>
            <strong>Enviar</strong>
            <span className="muted small">o APK fica no servidor; nenhum coletor recebe</span>
          </li>
          <li>
            <strong>Pilotos</strong>
            <span className="muted small">só os coletores marcados como piloto recebem, em produção</span>
          </li>
          <li>
            <strong>Todos</strong>
            <span className="muted small">todos recebem; o teste acaba</span>
          </li>
        </ol>
        <span className="muted small">
          Cada passo pode ser agora ou agendado. Um coletor com carga aberta só recebe (e só recarrega a página) quando ela fechar.
        </span>
      </div>

      <section className="card stack">
        <h2>App do kiosk (StarX Kiosk)</h2>
        <KioskVersions data={releases} canPublish={me.platform} maxApkMb={kiosk.maxApkMb} autoUpdate={kiosk.autoUpdate} />
      </section>

      <section className="card stack">
        <h2>Leitor do SSW</h2>
        <ReaderVersions data={releases} canPublish={me.platform} />
      </section>

      <section className="card stack">
        <h2>Coletores piloto</h2>
        <PilotDevices data={releases} />
      </section>

      <h2 style={{ margin: "8px 0 0" }}>Repositório de apps da empresa</h2>
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
