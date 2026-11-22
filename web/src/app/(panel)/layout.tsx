import { api, type Me } from "@/lib/api";
import { Sidebar, TabBar, TopBar } from "@/components/Nav";
import { PageTransition } from "@/components/animate-ui/components/page-transition";
import { OpsNotifications } from "@/components/OpsNotifications";
import { OpsStreamProvider } from "@/lib/useOpsStream";
import { ConfirmProvider } from "@/components/ConfirmDialog";

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const me = await api<Me>("/v1/admin/me");
  return (
    <OpsStreamProvider>
      <ConfirmProvider>
      <div className="shell">
        <Sidebar username={me.username} role={me.role} />
        <main className="main">
          <TopBar />
          <PageTransition effect="flow" className="page">
            {children}
          </PageTransition>
        </main>
        <TabBar role={me.role} />
        <OpsNotifications />
      </div>
      </ConfirmProvider>
    </OpsStreamProvider>
  );
}
