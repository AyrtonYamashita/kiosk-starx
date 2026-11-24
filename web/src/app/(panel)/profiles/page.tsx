import Link from "next/link";
import { api, type Me, type OpsSettings, type Profile } from "@/lib/api";
import { dateTime, kioskModeLabel } from "@/lib/format";
import type { Json } from "@/lib/api";
import { ReaderAll } from "./ReaderAll";

export const dynamic = "force-dynamic";

function summary(c: Record<string, Json>): string {
  const k = c.kiosk ?? {};
  if (k.enabled === false) return "kiosk desligado";
  const mode = kioskModeLabel[k.mode ?? "apps"] ?? k.mode;
  if (k.mode === "app") return `${mode}: ${k.app ?? "—"}`;
  if (k.mode === "web") return `${mode}: ${k.web?.url || "—"}`;
  return `${mode}: ${(k.apps ?? []).length} app(s)`;
}

export default async function ProfilesPage() {
  const [{ profiles }, settings, me] = await Promise.all([
    api<{ profiles: Profile[] }>("/v1/admin/profiles"),
    api<OpsSettings>("/v1/admin/ops/settings"),
    api<Me>("/v1/admin/me"),
  ]);
  return (
    <div className="stack">
      <div className="row">
        <h1 style={{ margin: 0 }}>Perfis</h1>
        <span className="spacer" />
        <Link href="/profiles/new" className="button">
          + Novo perfil
        </Link>
      </div>
      <div className="card small">
        Um <strong>perfil</strong> é a configuração do kiosk (modo, apps, site, PIN, restrições) aplicada a vários aparelhos. Ao salvar, os
        aparelhos do perfil recebem a configuração no próximo contato. Cada aparelho pode ter ajustes próprios por cima do perfil.
      </div>
      {/* chave geral da leitura do SSW (antes no cabeçalho de Aparelhos); o ajuste por coletor fica no detalhe do aparelho */}
      <div className="card stack" style={{ gap: 10 }}>
        <ReaderAll settings={settings} canEdit={me.role === "admin"} />
        <span className="muted small">
          Lendo em {settings.devices.reading} de {settings.devices.total} coletores. &quot;Todos&quot; liga a leitura em todos os coletores (menos os
          desligados um a um); &quot;Pilotos&quot; lê só nos coletores ligados um a um no detalhe do aparelho.
        </span>
      </div>
      {profiles.length === 0 ? (
        <div className="card">Nenhum perfil ainda.</div>
      ) : (
        <div className="card table-wrap" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Perfil</th>
                <th>Configuração</th>
                <th>Aparelhos</th>
                <th className="hide-sm">Alterado</th>
              </tr>
            </thead>
            <tbody>
              {profiles.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link href={`/profiles/${p.id}`}>
                      <strong>{p.name}</strong>
                    </Link>
                    {p.description && <div className="muted small">{p.description}</div>}
                  </td>
                  <td className="small">
                    {summary(p.config)}
                    {p.config.security?.pinHash === "<definido>" && <span className="badge off" style={{ marginLeft: 6 }}>PIN</span>}
                  </td>
                  <td>{p.devices}</td>
                  <td className="hide-sm small">{dateTime(p.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
