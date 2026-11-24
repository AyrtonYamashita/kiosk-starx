import { LogOut } from "lucide-react";
import { logout } from "@/lib/actions";
import { api, type Me, type MfaInfo, type PushInfo, type SessionInfo } from "@/lib/api";
import { SessionsTable } from "@/components/SessionsTable";
import { ThemePicker } from "@/components/brand/ThemePicker";
import { PasswordForm } from "./PasswordForm";
import { PasskeysSection } from "./PasskeysSection";
import { TotpSection } from "./TotpSection";
import { PushCard } from "./PushCard";
import { RecoveryCodes, TrustedDevices } from "./MfaCard";
import Link from "next/link";
import { privacyConfig } from "@/lib/privacy";

export const dynamic = "force-dynamic";

/*
  Conta. No desktop as duas colunas têm a altura do menu lateral (topo e fim alinhados com ele):
  esquerda estreita com perfil, aparência e senha; direita com a verificação em duas etapas e as sessões.
  O último card de cada coluna estica até o fim; se o conteúdo passar da altura, a coluna rola.
*/
export default async function AccountPage() {
  const [me, { sessions, idleHours }, mfa, push] = await Promise.all([
    api<Me>("/v1/admin/me"),
    api<{ sessions: SessionInfo[]; idleHours: number }>("/v1/admin/sessions"),
    api<MfaInfo>("/v1/admin/mfa"),
    // API antiga (sem notificações): a página abre sem o card
    api<PushInfo>("/v1/admin/push").catch(() => null),
  ]);
  const others = sessions.filter((s) => !s.current).length;

  return (
    <div className="account-page wide">
      <div className="account-col account-side">
        <section className="card account-profile">
          <span className="section-label">Conta</span>
          <div className="account-who">
            <span className="avatar account-avatar">{me.username.slice(0, 2).toUpperCase()}</span>
            <div className="account-id">
              <h1 className="account-name mono">{me.username}</h1>
              <span className="muted small account-email">{me.email ?? "sem e-mail cadastrado"}</span>
            </div>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <span className={`badge ${me.role === "admin" ? "blue" : "off"}`}>
              <span className="dot" /> {me.role === "admin" ? "administrador" : "operador"}
            </span>
            {mfa.required ? (
              <span className="badge ok">
                <span className="dot" /> duas etapas obrigatória
              </span>
            ) : (
              <span className="badge off">
                <span className="dot" /> duas etapas opcional
              </span>
            )}
          </div>
          <form action={logout}>
            <button className="account-logout">
              <LogOut size={14} aria-hidden /> Sair desta sessão
            </button>
          </form>
          <div className="row" style={{ gap: 12, justifyContent: "space-between" }}>
            <a href="/account/export" className="link-button small" download>
              Baixar meus dados
            </a>
            {privacyConfig() && (
              <Link href="/privacidade" className="muted small" target="_blank">
                Política de privacidade
              </Link>
            )}
          </div>
        </section>

        <section className="card account-card">
          <h2>Aparência</h2>
          <ThemePicker />
          <span className="muted small">Vale para este navegador.</span>
        </section>

        {push && <PushCard info={push} />}

        <section className="card account-card account-fill">
          <h2>Trocar senha</h2>
          <PasswordForm />
        </section>
      </div>

      <div className="account-col account-main">
        <section className="card account-card">
          <h2>Verificação em duas etapas</h2>
          <p className="muted small" style={{ margin: 0, overflowWrap: "anywhere" }}>
            Sem passkey nem app, o código de entrada vai por e-mail para <span className="mono">{mfa.email ?? "— (sem e-mail: peça ao administrador)"}</span>.
          </p>
          <div className="account-grid">
            <div className="account-sec">
              <h3>Passkeys ({mfa.passkeys.length})</h3>
              <PasskeysSection passkeys={mfa.passkeys} />
            </div>
            <div className="account-sec">
              <h3>App autenticador</h3>
              <TotpSection enabled={mfa.totp.enabled} since={mfa.totp.since} />
            </div>
            <div className="account-sec">
              <h3>Códigos de recuperação</h3>
              <RecoveryCodes left={mfa.recoveryCodesLeft} />
            </div>
            <div className="account-sec">
              <h3>Navegadores confiáveis ({mfa.trustedDevices.length})</h3>
              <TrustedDevices info={mfa} />
            </div>
          </div>
        </section>

        <section className="card account-card account-fill">
          <h2>Sessões ativas ({sessions.length})</h2>
          <span className="muted small">
            {others > 0 ? `${others} em outros navegadores. ` : ""}Cada sessão vale até 2 dias e expira após {idleHours} h sem uso. Encerrar uma
            sessão desconecta aquele navegador na hora.
          </span>
          <SessionsTable sessions={sessions} />
        </section>
      </div>
    </div>
  );
}
