"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ComponentType } from "react";
import { Ellipsis, X } from "lucide-react";
import { AnimateIcon } from "@animate-ui/react/icons";
import { Activity } from "@/components/animate-ui/icons/activity";
import { Truck } from "@/components/animate-ui/icons/truck";
import { LogOut } from "@/components/animate-ui/icons/log-out";
import { Package } from "@/components/animate-ui/icons/package";
import { QrCode } from "@/components/animate-ui/icons/qr-code";
import { ShieldCheck } from "@/components/animate-ui/icons/shield-check";
import { SlidersHorizontal } from "@/components/animate-ui/icons/sliders-horizontal";
import { Smartphone } from "@/components/animate-ui/icons/smartphone";
import { UserRound } from "@/components/animate-ui/icons/user-round";
import { Lock } from "@/components/animate-ui/icons/lock";
import { Layers } from "@/components/animate-ui/icons/layers";
import { logout } from "@/lib/actions";
import { closeSheet } from "@/lib/sheet";
import { StarxLogo } from "@/components/brand/Logo";

const LINKS: { href: string; label: string; short: string; icon: ComponentType<{ size?: number; strokeWidth?: number; "aria-hidden"?: boolean }>; match: (p: string) => boolean; adminOnly?: boolean; platform?: boolean }[] = [
  { href: "/platform", label: "Empresas", short: "Empresas", icon: Layers, match: (p) => p.startsWith("/platform"), platform: true },
  { href: "/operations", label: "Acompanhamento", short: "Ao vivo", icon: Activity, match: (p) => p.startsWith("/operations") },
  { href: "/cargas", label: "Cargas", short: "Cargas", icon: Truck, match: (p) => p.startsWith("/cargas") },
  { href: "/", label: "Aparelhos", short: "Aparelhos", icon: Smartphone, match: (p) => p === "/" || p.startsWith("/devices") },
  { href: "/profiles", label: "Perfis", short: "Perfis", icon: SlidersHorizontal, match: (p) => p.startsWith("/profiles") },
  { href: "/apps", label: "Apps", short: "Apps", icon: Package, match: (p) => p.startsWith("/apps") },
  { href: "/enroll", label: "Cadastro", short: "Cadastro", icon: QrCode, match: (p) => p.startsWith("/enroll") },
  { href: "/users", label: "Usuários", short: "Usuários", icon: ShieldCheck, match: (p) => p.startsWith("/users"), adminOnly: true },
  { href: "/titulares", label: "Privacidade", short: "Privacidade", icon: Lock, match: (p) => p.startsWith("/titulares"), adminOnly: true },
  { href: "/account", label: "Conta", short: "Conta", icon: UserRound, match: (p) => p.startsWith("/account") },
];

/**
 * Itens do menu: "Empresas" só para a plataforma; a plataforma fora de uma empresa vê só Empresas, Apps e Conta; os
 * demais, conforme o papel.
 */
function linksFor(role: "admin" | "operator", platformOnly = false, platform = false) {
  return LINKS.filter(
    (l) => (!l.platform || platform) && (!l.adminOnly || role === "admin") && (!platformOnly || l.platform || l.href === "/apps" || l.href === "/account"),
  );
}

function initials(name: string) {
  return name.slice(0, 2).toUpperCase();
}

/** Menu lateral flutuante (desktop): marca, navegação e o bloco do usuário com "Sair". */
export function Sidebar({
  username,
  role,
  platformOnly = false,
  platform = false,
}: {
  username: string;
  role: "admin" | "operator";
  platformOnly?: boolean;
  platform?: boolean;
}) {
  const path = usePathname();
  const links = linksFor(role, platformOnly, platform);
  return (
    <aside className="sidebar">
      <div className="brand">
        <StarxLogo size={24} />
      </div>
      <span className="section-label">Operação</span>
      <nav>
        {links.map((l) => (
          <AnimateIcon key={l.href} animateOnHover animateOnTap asChild>
            <Link href={l.href} className={`nav-item${l.match(path) ? " active" : ""}`} aria-current={l.match(path) ? "page" : undefined}>
              <l.icon size={18} strokeWidth={1.75} aria-hidden />
              <span>{l.label}</span>
            </Link>
          </AnimateIcon>
        ))}
      </nav>
      <div className="user">
        <Link href="/account" className="who" title="Minha conta">
          <span className="avatar">{initials(username)}</span>
          <span style={{ minWidth: 0 }}>
            <span className="name" style={{ display: "block", color: "var(--ink)" }}>{username}</span>
            <span className="role">{platform ? "plataforma" : role === "admin" ? "administrador" : "operador"}</span>
          </span>
        </Link>
        <form action={logout}>
          <AnimateIcon animateOnHover animateOnTap asChild>
            <button className="logout">
              <LogOut size={18} strokeWidth={1.75} aria-hidden /> Sair
            </button>
          </AnimateIcon>
        </form>
      </div>
    </aside>
  );
}

/** Barra do topo (celular): logotipo; o menu vira a barra de abas inferior. */
export function TopBar() {
  return (
    <header className="topbar">
      <StarxLogo size={22} />
    </header>
  );
}

/** Abas fixas da barra inferior; o resto do menu fica na folha "Mais". */
const TAB_HREFS = ["/operations", "/cargas", "/"];

/**
 * Barra de abas inferior (celular): 3 abas + "Mais". A folha "Mais" é um <dialog> modal (foco preso, Esc fecha,
 * o foco volta ao botão) com os demais itens do menu lateral e o "Sair".
 */
export function TabBar({ role, platformOnly = false, platform = false }: { role: "admin" | "operator"; platformOnly?: boolean; platform?: boolean }) {
  const path = usePathname();
  const links = linksFor(role, platformOnly, platform);
  const tabs = links.filter((l) => TAB_HREFS.includes(l.href));
  const more = links.filter((l) => !TAB_HREFS.includes(l.href));
  const moreActive = more.some((l) => l.match(path));
  const sheetRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  // fecha ao navegar (com animação) e quando a tela passa para o layout de desktop (na hora: a barra some)
  useEffect(() => {
    closeSheet(sheetRef.current);
  }, [path]);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const onChange = () => {
      if (mq.matches) sheetRef.current?.close();
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const show = () => {
    const d = sheetRef.current;
    if (d && !d.open) {
      d.showModal();
      setOpen(true);
    }
  };
  const hide = () => closeSheet(sheetRef.current);

  return (
    <>
      <nav className="tabbar" aria-label="Navegação">
        {tabs.map((l) => (
          <AnimateIcon key={l.href} animateOnTap asChild>
            <Link href={l.href} className={l.match(path) ? "active" : undefined} aria-current={l.match(path) ? "page" : undefined}>
              <l.icon size={20} strokeWidth={1.75} aria-hidden />
              <span>{l.short}</span>
            </Link>
          </AnimateIcon>
        ))}
        <button
          ref={triggerRef}
          type="button"
          className={`tabbar-more${moreActive ? " active" : ""}`}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls="more-sheet"
          onClick={show}
        >
          <Ellipsis size={20} strokeWidth={1.75} aria-hidden />
          <span>Mais</span>
        </button>
      </nav>
      <dialog
        ref={sheetRef}
        id="more-sheet"
        className="more-sheet"
        aria-labelledby="more-sheet-title"
        onCancel={(e) => {
          // Esc / voltar do Android: fecha com a mesma animação dos outros jeitos
          e.preventDefault();
          hide();
        }}
        onClose={() => {
          setOpen(false);
          triggerRef.current?.focus();
        }}
        onClick={(e) => {
          // toque no fundo escurecido (fora da folha) fecha
          if (e.target === e.currentTarget) hide();
        }}
      >
        <div className="more-box">
          <div className="more-head">
            <h2 id="more-sheet-title">Mais</h2>
            <button type="button" className="more-close" aria-label="Fechar menu" onClick={hide}>
              <X size={20} strokeWidth={1.75} aria-hidden />
            </button>
          </div>
          <nav aria-label="Mais opções">
            {more.map((l) => (
              <AnimateIcon key={l.href} animateOnTap asChild>
                <Link href={l.href} className={`nav-item${l.match(path) ? " active" : ""}`} aria-current={l.match(path) ? "page" : undefined} onClick={hide}>
                  <l.icon size={18} strokeWidth={1.75} aria-hidden />
                  <span>{l.label}</span>
                </Link>
              </AnimateIcon>
            ))}
          </nav>
          <form action={logout} className="more-foot">
            <AnimateIcon animateOnTap asChild>
              <button className="logout">
                <LogOut size={18} strokeWidth={1.75} aria-hidden /> Sair
              </button>
            </AnimateIcon>
          </form>
        </div>
      </dialog>
    </>
  );
}
