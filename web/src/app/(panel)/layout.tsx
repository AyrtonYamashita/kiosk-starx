import { api, type Me } from "@/lib/api";
import { Sidebar, TabBar, TopBar } from "@/components/Nav";

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  // sem sessão válida, api() redireciona para /login
  const me = await api<Me>("/v1/admin/me");
  return (
    <div className="shell">
      <Sidebar username={me.username} role={me.role} />
      <main className="main">
        <TopBar />
        {children}
      </main>
      <TabBar role={me.role} />
    </div>
  );
}
