import { api, type Me } from "@/lib/api";
import { Sidebar, TabBar, TopBar } from "@/components/Nav";
import { PageTransition } from "@/components/animate-ui/components/page-transition";
import { OpsNotifications } from "@/components/OpsNotifications";
import { OpsStreamProvider } from "@/lib/useOpsStream";
import { ConfirmProvider } from "@/components/ConfirmDialog";
import { ToastProvider } from "@/components/Toasts";

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const me = await api<Me>("/v1/admin/me");
  // usuário da plataforma (sem empresa): só Apps (app do kiosk) e Conta, sem a conexão ao vivo
  const platformOnly = !me.tenant;
  return (
    <OpsStreamProvider enabled={!platformOnly}>
      <ToastProvider>
      <ConfirmProvider>
      <div className="shell">
        <Sidebar username={me.displayName ?? me.username} role={me.role} platformOnly={platformOnly} />
        <main className="main">
          <TopBar />
          <PageTransition effect="flow" className="page">
            {children}
          </PageTransition>
        </main>
        <TabBar role={me.role} platformOnly={platformOnly} />
        {!platformOnly && <OpsNotifications />}
      </div>
      </ConfirmProvider>
      </ToastProvider>
    </OpsStreamProvider>
  );
}
