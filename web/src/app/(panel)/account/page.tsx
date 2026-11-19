import { logout } from "@/lib/actions";
import { api, type Me, type MfaInfo, type SessionInfo } from "@/lib/api";
import { MfaCard } from "./MfaCard";
import { SessionsTable } from "@/components/SessionsTable";
import { PasswordForm } from "./PasswordForm";
import { ThemePicker } from "@/components/brand/ThemePicker";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const [me, { sessions, idleHours }, mfa] = await Promise.all([
    api<Me>("/v1/admin/me"),
    api<{ sessions: SessionInfo[]; idleHours: number }>("/v1/admin/sessions"),
    api<MfaInfo>("/v1/admin/mfa"),
  ]);
  return (
    <div className="stack">
      <div className="page-header">
        <h1>Conta</h1>
        <p>
          <span className="mono">{me.username}</span> · {me.email ?? "sem e-mail cadastrado"} · {me.role === "admin" ? "administrador" : "operador"}
        </p>
      </div>
      <form action={logout}>
        <button>Sair desta sessão</button>
      </form>
      <div className="grid" style={{ alignItems: "start" }}>
        <section className="card stack">
          <h2>Aparência</h2>
          <ThemePicker />
          <span className="muted small">Vale para este navegador.</span>
        </section>
        <section className="card stack">
          <h2>Trocar senha</h2>
          <PasswordForm />
        </section>
        <section className="card stack">
          <h2>Verificação em duas etapas</h2>
          <MfaCard info={mfa} />
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
