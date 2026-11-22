import { notFound } from "next/navigation";
import { SessionsTable } from "@/components/SessionsTable";
import { unlock } from "@/lib/actions";
import { api, type AuthEvent, type Lockout, type Me, type SessionInfo, type UserInfo } from "@/lib/api";
import { ago, dateTime } from "@/lib/format";
import { CreateUserForm, EditUser } from "./UserForms";

export const dynamic = "force-dynamic";

const EVENT_LABEL: Record<string, [string, string]> = {
  login_success: ["ok", "login"],
  login_failure: ["warn", "falha de login"],
  login_blocked: ["danger", "barrado (bloqueio)"],
  lockout: ["danger", "bloqueio"],
  unlock: ["blue", "desbloqueio"],
  logout: ["off", "saiu"],
  session_revoked: ["off", "sessão encerrada"],
  password_changed: ["blue", "trocou a senha"],
  user_created: ["blue", "usuário criado"],
  user_updated: ["blue", "usuário alterado"],
  privacy_export: ["blue", "dados de colaborador exportados"],
  privacy_anonymize: ["warn", "colaborador anonimizado"],
  privacy_self_export: ["off", "baixou os próprios dados"],
};

const REASON: Record<string, string> = { unknown_account: "conta inexistente", bad_password: "senha errada", disabled: "conta desativada" };

export default async function UsersPage() {
  const me = await api<Me>("/v1/admin/me");
  if (me.role !== "admin") notFound();
  const [{ users }, { lockouts }, { events }, { sessions }] = await Promise.all([
    api<{ users: UserInfo[] }>("/v1/admin/users"),
    api<{ lockouts: Lockout[] }>("/v1/admin/security/lockouts"),
    api<{ events: AuthEvent[] }>("/v1/admin/security/events?limit=100"),
    api<{ sessions: SessionInfo[] }>("/v1/admin/sessions?all=1"),
  ]);
  return (
    <div className="stack wide">
      <div className="page-header">
        <h1>Usuários</h1>
        <p>Quem acessa o painel. Administrador: tudo, inclusive esta tela. Operador: aparelhos, comandos e acompanhamento.</p>
      </div>

      <section className="card stack" style={{ padding: 0, gap: 0 }}>
        <h2 style={{ margin: 0, padding: "12px 16px", borderBottom: "1px solid var(--rule)" }}>Contas ({users.length})</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Usuário</th>
                <th>Papel</th>
                <th>Situação</th>
                <th className="hide-sm">Último login</th>
                <th className="hide-sm">Sessões</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>
                    <span className="mono">{u.username}</span> {u.id === me.id && <span className="badge blue">você</span>}
                    <div className="muted small">{u.email ?? "sem e-mail"}</div>
                  </td>
                  <td>{u.role === "admin" ? "Administrador" : "Operador"}</td>
                  <td>
                    {u.disabled ? (
                      <span className="badge off">
                        <span className="dot" /> desativado
                      </span>
                    ) : u.lockedUntil ? (
                      <span className="badge danger" title={`até ${dateTime(u.lockedUntil)}`}>
                        <span className="dot" /> bloqueado
                      </span>
                    ) : (
                      <span className="badge ok">
                        <span className="dot" /> ativo
                      </span>
                    )}
                  </td>
                  <td className="hide-sm small">{u.lastLoginAt ? ago(u.lastLoginAt) : "nunca"}</td>
                  <td className="hide-sm mono">{u.activeSessions}</td>
                  <td style={{ textAlign: "right" }}>
                    <EditUser user={u} self={u.id === me.id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card stack">
        <h2>Novo usuário</h2>
        <CreateUserForm />
      </section>

      <section className="card stack">
        <h2>Bloqueios ativos</h2>
        <span className="muted small">
          5 senhas erradas bloqueiam a conta; 20 erros do mesmo IP bloqueiam o IP. O bloqueio cresce a cada vez (1 min → 5 min → 15 min → 1 h) e sai sozinho.
        </span>
        {lockouts.length === 0 ? (
          <span className="muted small">Nenhum bloqueio agora.</span>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Tipo</th>
                  <th>Conta / IP</th>
                  <th>Até</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {lockouts.map((l) => (
                  <tr key={`${l.kind}:${l.key}`}>
                    <td>{l.kind === "ip" ? "IP" : "Conta"}</td>
                    <td className="mono">{l.key}</td>
                    <td className="small">
                      {dateTime(l.lockedUntil)} <span className="muted">({l.level}º bloqueio)</span>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <form action={unlock}>
                        <input type="hidden" name="kind" value={l.kind} />
                        <input type="hidden" name="key" value={l.key} />
                        <button>Desbloquear</button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card stack">
        <h2>Sessões ativas (todos)</h2>
        <SessionsTable sessions={sessions} showUser />
      </section>

      <section className="card stack" style={{ padding: 0, gap: 0 }}>
        <h2 style={{ margin: 0, padding: "12px 16px", borderBottom: "1px solid var(--rule)" }}>Auditoria (últimos 100 eventos)</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Quando</th>
                <th>Evento</th>
                <th>Conta</th>
                <th className="hide-sm">IP</th>
                <th className="hide-sm">Detalhe</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => {
                const [tone, label] = EVENT_LABEL[e.event] ?? ["off", e.event];
                const reason = typeof e.details?.reason === "string" ? (REASON[e.details.reason] ?? e.details.reason) : null;
                return (
                  <tr key={e.id}>
                    <td className="small mono">{dateTime(e.createdAt)}</td>
                    <td>
                      <span className={`badge ${tone}`}>{label}</span>
                    </td>
                    <td className="mono small">{e.username ?? e.identifier ?? "—"}</td>
                    <td className="hide-sm mono small">{e.ip ?? "—"}</td>
                    <td className="hide-sm small muted">{reason ?? (e.details ? JSON.stringify(e.details).slice(0, 80) : "")}</td>
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
