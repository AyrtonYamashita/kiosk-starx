import { useSyncExternalStore } from "react";

const noop = () => () => {};

/** false no servidor e na hidratação; true depois, no navegador (sem setState em efeito). */
export function useHydrated(): boolean {
  return useSyncExternalStore(noop, () => true, () => false);
}

/** Valor que só existe no navegador (ex.: suporte a passkey ou WebUSB); `server` vale no servidor e na hidratação. */
export function useClientValue<T extends string | number | boolean | null>(read: () => T, server: T): T {
  return useSyncExternalStore(noop, read, () => server);
}
