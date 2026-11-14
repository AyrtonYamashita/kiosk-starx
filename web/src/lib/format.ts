const TZ = "America/Sao_Paulo";

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", { timeZone: TZ, dateStyle: "short", timeStyle: "short" });
}

/** "há 2 min", "há 3 h", "há 5 d" */
export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "nunca";
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return "agora";
  const m = Math.round(s / 60);
  if (m < 60) return `há ${m} min`;
  const h = Math.round(m / 60);
  if (h < 48) return `há ${h} h`;
  return `há ${Math.round(h / 24)} d`;
}

export function bytes(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  if (n >= 1_073_741_824) return `${(n / 1_073_741_824).toFixed(1).replace(".", ",")} GB`;
  return `${Math.round(n / 1_048_576)} MB`;
}

export function uptime(ms: number | null | undefined): string {
  if (!ms) return "—";
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min} min`;
  if (min < 1440) return `${Math.floor(min / 60)} h ${min % 60} min`;
  return `${Math.floor(min / 1440)} d ${Math.floor((min % 1440) / 60)} h`;
}

export const kioskModeLabel: Record<string, string> = { app: "App único", apps: "Grade de apps", web: "Site" };

export const networkLabel: Record<string, string> = { wifi: "Wi-Fi", cellular: "Dados móveis", ethernet: "Cabo", none: "Sem rede", other: "Outra" };

export const enrollmentStatus: Record<"active" | "expired" | "exhausted" | "revoked", [string, string]> = {
  active: ["ok", "ativo"],
  expired: ["off", "expirado"],
  exhausted: ["off", "esgotado"],
  revoked: ["danger", "revogado"],
};

/** Situação da configuração do painel no aparelho: [classe do badge, rótulo, explicação]. */
export const configStatusLabel: Record<"none" | "applied" | "modified" | "pending" | "error", [string, string, string]> = {
  none: ["off", "local", "sem perfil: o aparelho usa a configuração feita nele"],
  applied: ["ok", "aplicada", "o aparelho está com a configuração do painel"],
  modified: ["warn", "alterada no aparelho", "aplicada, mas alterada depois no próprio aparelho; reaplique para desfazer"],
  pending: ["warn", "pendente", "o aparelho recebe no próximo contato"],
  error: ["danger", "erro", "o aparelho recusou a configuração"],
};
