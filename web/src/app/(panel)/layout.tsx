import { api } from "@/lib/api";
import { logout } from "@/lib/actions";
import { Nav } from "@/components/Nav";

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  // sem sessão válida, api() redireciona para /login
  const me = await api<{ username: string }>("/v1/admin/me");
  return (
    <>
      <header className="topbar">
        <span className="brand">StarX Kiosk</span>
        <Nav />
        <span className="muted small hide-sm">{me.username}</span>
        <form action={logout}>
          <button className="link-button">Sair</button>
        </form>
      </header>
      <main className="main">{children}</main>
    </>
  );
}
