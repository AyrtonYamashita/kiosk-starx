import Link from "next/link";
import { api, type Enrollment, type Release } from "@/lib/api";
import { dateTime, enrollmentStatus as statusBadge } from "@/lib/format";
import { CreateEnrollment } from "./CreateEnrollment";

export const dynamic = "force-dynamic";

export default async function EnrollPage() {
  const { enrollments, release } = await api<{ enrollments: Enrollment[]; release: Release | null }>("/v1/admin/enrollments");
  return (
    <div className="stack">
      <h1>Cadastro de aparelhos</h1>
      <div className="card small">
        Um <strong>código de cadastro</strong> liga aparelhos ao painel. Ele serve de três formas:
        <ul style={{ margin: "8px 0 0", paddingLeft: 20 }}>
          <li>
            <strong>QR de provisionamento</strong> (aparelho novo ou resetado): instala o app, define o Device Owner e cadastra.
          </li>
          <li>
            <strong>Digitado no aparelho</strong> que já tem o app: administração → Avançado → Painel.
          </li>
          <li>
            <strong>ADB</strong>: comando na página do código.
          </li>
        </ul>
        {!release && <div className="alert warn" style={{ marginTop: 10 }}>Nenhum APK publicado no servidor: o QR fica indisponível até publicar (deploy/README.md).</div>}
        {release && (
          <div className="muted" style={{ marginTop: 10 }}>
            APK publicado: {release.versionName} ({release.versionCode}), {dateTime(release.builtAt)}.
          </div>
        )}
      </div>

      <section className="card stack">
        <h2>Novo código</h2>
        <CreateEnrollment />
      </section>

      <section className="card table-wrap" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>Nome</th>
              <th>Código</th>
              <th>Usos</th>
              <th className="hide-sm">Validade</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {enrollments.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  Nenhum código ainda.
                </td>
              </tr>
            )}
            {enrollments.map((e) => (
              <tr key={e.id}>
                <td>
                  <Link href={`/enroll/${e.id}`}>
                    <strong>{e.name}</strong>
                  </Link>
                  {e.initialConfig ? <div className="muted small">com configuração inicial</div> : null}
                </td>
                <td className="mono">{e.code}</td>
                <td>
                  {e.uses}
                  {e.maxUses !== null ? ` / ${e.maxUses}` : ""}
                </td>
                <td className="hide-sm">{e.expiresAt ? dateTime(e.expiresAt) : "sem validade"}</td>
                <td>
                  <span className={`badge ${statusBadge[e.status][0]}`}>{statusBadge[e.status][1]}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
