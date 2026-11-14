"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Aparelhos", match: (p: string) => p === "/" || p.startsWith("/devices") },
  { href: "/enroll", label: "Cadastro", match: (p: string) => p.startsWith("/enroll") },
  { href: "/account", label: "Conta", match: (p: string) => p.startsWith("/account") },
];

export function Nav() {
  const path = usePathname();
  return (
    <nav>
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} className={l.match(path) ? "active" : undefined}>
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
