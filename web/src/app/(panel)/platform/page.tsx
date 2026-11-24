import { notFound } from "next/navigation";
import { enterTenant } from "@/lib/actions";
import { api, type AuthEvent, type Me, type PlatformTenant } from "@/lib/api";
import { ago, dateTime } from "@/lib/format";
import { CreateTenantForm, TenantStatus } from "./TenantForms";

export const dynamic = "force-dynamic";

const EVENT_LABEL: Record<string, string> = {
  tenant_created: "empresa criada",
  tenant_updated: "empresa alterada",
  tenant_suspended: "empresa suspensa",
  tenant_reactivated: "empresa reativada",
  tenant_enter: "entrou na empresa",
  tenant_exit: "saiu da empresa",
  login_success: "login",
  login_failure: "falha de login",
  login_blocked: "barrado (bloqueio)",
  lockout: "bloqueio",
  logout: "saiu",
};

/** Painel da plataforma (PStarX): empresas, primeiro administrador, suspensão e "entrar como". */
export default async function PlatformPage() {
  const me = await api<Me>("/v1/admin/me");
  if (!me.platform) notFound();
  const [{ tenants }, { events }] = await Promise.all([
    api<{ tenants: PlatformTenant[] }>("/v1/platform/tenants"),
    api<{ events: AuthEvent[] }>("/v1/platform/events?limit=50"),
  ]);
  const names = new Map(tenants.map((t) => [t.id, t.name]));
  return (
    <div className="stack wide">
      <div className="page-header">
        <h1>Empresas</h1>
        <p>
          Cada empresa vê só os coletores, usuários e cargas dela. Para dar suporte, entre na empresa: a sessão passa a ver o que um administrador dela vê, e a
          entrada fica na auditoria da empresa.
        </p>
      </div>

      <section className="card stack" style={{ padding: 0, gap: 0 }}>
        <h2 style={{ margin: 0, padding: "12px 16px", borderBottom: "1px solid var(--rule)" }}>Empresas ({tenants.length})</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Empresa</th>
                <th>Situação</th>
                <th>Coletores</th>
                <th className="hide-sm">Usuários</th>
                <th className="hide-sm">Último contato</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {tenants.map((t) => (
                <tr key={t.id}>
                  <td>
                    <strong>{t.name}</strong> {me.tenant?.id === t.id && <span className="badge blue">você está nela</span>}
                    <div className="muted small mono">
                      {t.slug} · desde {dateTime(t.createdAt)}
                    </div>
                  </td>
                  <td>
                    {t.status === "active" ? (
                      <span className="badge ok">
                        <span className="dot" /> ativa
                      </span>
                    ) : (
                      <span className="badge danger">
                        <span className="dot" /> suspensa
                      </span>
                    )}
                  </td>
                  <td className="small">
                    <strong>{t.online}</strong> de {t.devices} online
                  </td>
                  <td className="hide-sm mono">{t.users}</td>
                  <td className="hide-sm small">{t.lastSeenAt ? ago(t.lastSeenAt) : "—"}</td>
                  <td style={{ textAlign: "right" }}>
                    <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
                      <form action={enterTenant}>
                        <input type="hidden" name="id" value={t.id} />
                        <button className="primary">Entrar</button>
                      </form>
                      <TenantStatus tenant={t} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card stack">
        <h2>Nova empresa</h2>
        <CreateTenantForm />
      </section>

      <section className="card stack" style={{ padding: 0, gap: 0 }}>
        <h2 style={{ margin: 0, padding: "12px 16px", borderBottom: "1px solid var(--rule)" }}>Auditoria da plataforma (últimos 50)</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Quando</th>
                <th>Evento</th>
                <th>Conta</th>
                <th className="hide-sm">Detalhe</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => {
                const tid = typeof e.details?.tenantId === "string" ? e.details.tenantId : null;
                return (
                  <tr key={e.id}>
                    <td className="small mono">{dateTime(e.createdAt)}</td>
                    <td>{EVENT_LABEL[e.event] ?? e.event}</td>
                    <td className="mono small">{e.username ?? e.identifier ?? "—"}</td>
                    <td className="hide-sm small muted">{tid ? (names.get(tid) ?? tid) : e.ip ?? ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
