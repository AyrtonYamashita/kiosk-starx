import Link from "next/link";
import { api, type Profile } from "@/lib/api";
import { dateTime, kioskModeLabel } from "@/lib/format";
import type { Json } from "@/lib/api";

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
  const { profiles } = await api<{ profiles: Profile[] }>("/v1/admin/profiles");
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
