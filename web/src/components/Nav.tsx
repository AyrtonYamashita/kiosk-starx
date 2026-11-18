"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, LogOut, Package, QrCode, ShieldCheck, SlidersHorizontal, Smartphone, UserRound, type LucideIcon } from "lucide-react";
import { logout } from "@/lib/actions";

const LINKS: { href: string; label: string; short: string; icon: LucideIcon; match: (p: string) => boolean; adminOnly?: boolean }[] = [
  { href: "/operations", label: "Acompanhamento", short: "Ao vivo", icon: Activity, match: (p) => p.startsWith("/operations") },
  { href: "/", label: "Aparelhos", short: "Aparelhos", icon: Smartphone, match: (p) => p === "/" || p.startsWith("/devices") },
  { href: "/profiles", label: "Perfis", short: "Perfis", icon: SlidersHorizontal, match: (p) => p.startsWith("/profiles") },
  { href: "/apps", label: "Apps", short: "Apps", icon: Package, match: (p) => p.startsWith("/apps") },
  { href: "/enroll", label: "Cadastro", short: "Cadastro", icon: QrCode, match: (p) => p.startsWith("/enroll") },
  { href: "/users", label: "Usuários", short: "Usuários", icon: ShieldCheck, match: (p) => p.startsWith("/users"), adminOnly: true },
  { href: "/account", label: "Conta", short: "Conta", icon: UserRound, match: (p) => p.startsWith("/account") },
];

function initials(name: string) {
  return name.slice(0, 2).toUpperCase();
}

/** Menu lateral flutuante (desktop): marca, navegação e o bloco do usuário com "Sair". */
export function Sidebar({ username, role }: { username: string; role: "admin" | "operator" }) {
  const path = usePathname();
  const links = LINKS.filter((l) => !l.adminOnly || role === "admin");
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="mark" aria-hidden />
        <strong>StarX Kiosk</strong>
      </div>
      <span className="section-label">Operação</span>
      <nav>
        {links.map((l) => (
          <Link key={l.href} href={l.href} className={`nav-item${l.match(path) ? " active" : ""}`} aria-current={l.match(path) ? "page" : undefined}>
            <l.icon size={15} />
            <span>{l.label}</span>
          </Link>
        ))}
      </nav>
      <div className="user">
        <Link href="/account" className="who" title="Minha conta">
          <span className="avatar">{initials(username)}</span>
          <span style={{ minWidth: 0 }}>
            <span className="name" style={{ display: "block", color: "var(--ink)" }}>{username}</span>
            <span className="role">{role === "admin" ? "administrador" : "operador"}</span>
          </span>
        </Link>
        <form action={logout}>
          <button className="logout">
            <LogOut size={14} /> Sair
          </button>
        </form>
      </div>
    </aside>
  );
}

/** Barra de abas inferior (celular). */
export function TabBar({ role }: { role: "admin" | "operator" }) {
  const path = usePathname();
  const links = LINKS.filter((l) => !l.adminOnly || role === "admin");
  return (
    <nav className="tabbar" aria-label="Navegação">
      {links.map((l) => (
        <Link key={l.href} href={l.href} className={l.match(path) ? "active" : undefined} aria-current={l.match(path) ? "page" : undefined}>
          <l.icon size={19} />
          <span>{l.short}</span>
        </Link>
      ))}
    </nav>
  );
}
