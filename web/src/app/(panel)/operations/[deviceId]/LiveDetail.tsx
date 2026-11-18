"use client";

import { useRouter } from "next/navigation";
import { useRef } from "react";
import { fmtDuration } from "@/lib/opsFormat";
import { useNow, useOpsStream } from "@/lib/useOpsStream";

/** Mantém o detalhe ao vivo: quando o card deste coletor muda, relê a página (no máximo 1×/s). */
export function LiveDetail({ deviceId }: { deviceId: string }) {
  const router = useRouter();
  const last = useRef(0);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refresh = () => {
    if (pending.current) return;
    const wait = Math.max(0, 1000 - (Date.now() - last.current));
    pending.current = setTimeout(() => {
      pending.current = null;
      last.current = Date.now();
      router.refresh();
    }, wait);
  };
  const { status } = useOpsStream({
    card: (c) => c.deviceId === deviceId && refresh(),
    removed: (id) => id === deviceId && router.replace("/operations"),
  });
  return status === "live" ? (
    <span className="badge ok">
      <span className="dot live-dot" /> ao vivo
    </span>
  ) : (
    <span className="badge warn">
      <span className="dot" /> {status === "ended" ? "sessão encerrada" : "reconectando…"}
    </span>
  );
}

/** Tempo correndo desde `since` (ex.: duração da carga aberta). */
export function Elapsed({ since, serverTime, extraSec = 0 }: { since: string; serverTime: number; extraSec?: number }) {
  const now = useNow(serverTime, null);
  return <>{fmtDuration((now - new Date(since).getTime()) / 1000 + extraSec)}</>;
}
