import { useSyncExternalStore } from "react";

/*
  Relógio compartilhado da tela de operações: um único setInterval de 1 s para a página toda, ajustado à hora do
  servidor. Cada componente lê só o que precisa (um texto, um booleano) e redesenha apenas quando esse valor muda.
*/
let offset = 0;
let now = Date.now();
let timer: ReturnType<typeof setInterval> | undefined;
const subs = new Set<() => void>();

function tick() {
  now = Date.now() + offset;
  subs.forEach((f) => f());
}

function subscribe(f: () => void) {
  subs.add(f);
  if (!timer) {
    now = Date.now() + offset;
    timer = setInterval(tick, 1000);
  }
  return () => {
    subs.delete(f);
    if (!subs.size && timer) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

/** Diferença entre a hora do servidor e a deste navegador (vinda do canal ao vivo). */
export function setClockOffset(ms: number) {
  if (ms === offset) return;
  offset = ms;
  tick();
}

/** Valor derivado do relógio; `serverNow` é a hora usada no HTML do servidor (hidratação sem divergência). */
export function useClockValue<T extends string | number | boolean | null>(compute: (now: number) => T, serverNow: number): T {
  return useSyncExternalStore(
    subscribe,
    () => compute(now),
    () => compute(serverNow),
  );
}
