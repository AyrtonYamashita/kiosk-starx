"use client";

import type { ReactNode } from "react";
import { motion, useReducedMotion, type Variants } from "motion/react";

/*
  Fallback para ícones do Lucide que NÃO existem na coleção animada do Animate UI
  (package, qr-code, barcode, truck, warehouse...). Envolva o ícone estático do lucide-react.
  Os movimentos são os mesmos da página "Ícones" do brand. Dispara no hover do próprio elemento
  e no hover/foco do pai quando usado dentro de um botão ou link com a classe `group`.
*/
const V: Record<string, Variants> = {
  wiggle: { rest: { rotate: 0 }, go: { rotate: [0, -9, 8, -4, 0], transition: { duration: 0.8 } } },
  pulse:  { rest: { scale: 1 },  go: { scale: [1, 1.16, 1], transition: { duration: 0.8 } } },
  hop:    { rest: { y: 0 },      go: { y: [0, -5, 0, -2, 0], transition: { duration: 0.8 } } },
  drive:  { rest: { x: 0 },      go: { x: [0, 5, -2, 0], transition: { duration: 0.8 } } },
  spin:   { rest: { rotate: 0 }, go: { rotate: 360, transition: { duration: 1 } } },
  blink:  { rest: { opacity: 1 }, go: { opacity: [1, 0.35, 1, 0.35, 1], transition: { duration: 1 } } },
  slide:  { rest: { x: 0 },      go: { x: [0, -3, 3, 0], transition: { duration: 0.8 } } },
  drop:   { rest: { y: 0 },      go: { y: [0, 4, -1, 0], transition: { duration: 0.8 } } },
  tilt:   { rest: { rotate: 0 }, go: { rotate: [0, -8, 0], transition: { duration: 0.8 } } },
};

export function AnimatedIcon({ children, variant = "pulse", className }: { children: ReactNode; variant?: keyof typeof V; className?: string }) {
  const reduce = useReducedMotion();
  if (reduce) return <span className={className} style={{ display: "inline-flex" }}>{children}</span>;
  return (
    <motion.span className={className} style={{ display: "inline-flex" }} variants={V[variant]} initial="rest" whileHover="go" whileFocus="go" whileTap="go">
      {children}
    </motion.span>
  );
}
