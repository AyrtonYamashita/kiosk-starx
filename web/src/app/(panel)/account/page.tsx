import { logout } from "@/lib/actions";
import { api, type Me, type SessionInfo } from "@/lib/api";
import { SessionsTable } from "@/components/SessionsTable";
import { PasswordForm } from "./PasswordForm";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const [me, { sessions, idleHours }] = await Promise.all([
    api<Me>("/v1/admin/me"),
    api<{ sessions: SessionInfo[]; idleHours: number }>("/v1/admin/sessions"),
  ]);
  return (
    <div className="stack">
      <div className="page-header">
        <h1>Conta</h1>
        <p>
          <span className="mono">{me.username}</span> · {me.email ?? "sem e-mail cadastrado"} · {me.role === "admin" ? "administrador" : "operador"}
        </p>
      </div>
      {/* no celular o menu lateral (com "Sair") some: sair também por aqui */}
      <form action={logout}>
        <button>Sair desta sessão</button>
      </form>
      <div className="grid" style={{ alignItems: "start" }}>
        <section className="card stack">
          <h2>Trocar senha</h2>
          <PasswordForm />
        </section>
        <section className="card stack">
          <h2>Sessões ativas</h2>
          <span className="muted small">
            Cada sessão vale até 2 dias e expira após {idleHours} h sem uso. Encerrar uma sessão desconecta aquele navegador na hora.
          </span>
          <SessionsTable sessions={sessions} />
        </section>
      </div>
    </div>
  );
}
