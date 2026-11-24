import { api, type Me } from "@/lib/api";
import { Sidebar, TabBar, TopBar } from "@/components/Nav";
import { PageTransition } from "@/components/animate-ui/components/page-transition";
import { OpsNotifications } from "@/components/OpsNotifications";
import { OpsStreamProvider } from "@/lib/useOpsStream";
import { ConfirmProvider } from "@/components/ConfirmDialog";
import { ToastProvider } from "@/components/Toasts";
import { exitTenant } from "@/lib/actions";

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const me = await api<Me>("/v1/admin/me");
  // usuário da plataforma (sem empresa): só Apps (app do kiosk) e Conta, sem a conexão ao vivo
  const platformOnly = !me.tenant;
  return (
    <OpsStreamProvider enabled={!platformOnly}>
      <ToastProvider>
      <ConfirmProvider>
      <div className="shell">
        <Sidebar username={me.displayName ?? me.username} role={me.role} platformOnly={platformOnly} platform={me.platform} />
        <main className="main">
          <TopBar />
          {me.acting && me.tenant && (
            // suporte: a plataforma está vendo uma empresa (fica na auditoria das duas)
            <form action={exitTenant} className="alert warn row" style={{ margin: "12px 16px 0", justifyContent: "space-between", gap: 8 }}>
              <span>
                Você está vendo a empresa <strong>{me.tenant.name}</strong> como suporte. Tudo o que fizer fica na auditoria dela.
              </span>
              <button>Sair da empresa</button>
            </form>
          )}
          <PageTransition effect="flow" className="page">
            {children}
          </PageTransition>
        </main>
        <TabBar role={me.role} platformOnly={platformOnly} platform={me.platform} />
        {!platformOnly && <OpsNotifications />}
      </div>
      </ConfirmProvider>
      </ToastProvider>
    </OpsStreamProvider>
  );
}
