import webpush from "web-push";
import type { Config } from "./config.js";
import type { Db } from "./db.js";

/** Eventos que viram notificação no celular. */
export const PUSH_EVENTS = ["start", "done", "stopped", "scan_error"] as const;
export type PushEvent = (typeof PUSH_EVENTS)[number];
/** Quem nunca escolheu recebe estes (erro de bipagem é opcional: pode ser muita notificação). */
export const PUSH_DEFAULT: readonly PushEvent[] = ["start", "done", "stopped"];

/** O que aparece na notificação; `url` é a página do painel aberta ao tocar. */
export interface PushMessage {
  title: string;
  body: string;
  url: string;
  /** Mesma tag substitui a notificação anterior em vez de empilhar (ex.: a mesma carga). */
  tag?: string;
}

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** Entrega uma mensagem a um navegador; devolve o código HTTP do serviço de push (201 = aceita; 404/410 = inscrição morta). */
export type PushSender = (target: PushTarget, payload: string) => Promise<number>;

/**
 * Serviços de push dos navegadores. Só esses endereços são aceitos na inscrição: a API faz uma requisição para o
 * endpoint a cada envio, então um endereço qualquer viraria um jeito de fazer a API chamar a rede interna.
 */
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /^([a-z0-9-]+\.)*push\.apple\.com$/, /^[a-z0-9-]+\.notify\.windows\.com$/];

export function validEndpoint(endpoint: string): boolean {
  let u: URL;
  try {
    u = new URL(endpoint);
  } catch {
    return false;
  }
  return u.protocol === "https:" && !u.port && !u.username && !u.password && PUSH_HOSTS.some((h) => h.test(u.hostname));
}

/** Depois de tantas falhas seguidas (fora 404/410, que apagam na hora), a inscrição é descartada. */
const MAX_FAILURES = 10;

function webPushSender(config: Config): PushSender {
  const vapidDetails = { subject: config.vapidSubject, publicKey: config.vapidPublicKey!, privateKey: config.vapidPrivateKey! };
  return async (t, payload) => {
    try {
      const r = await webpush.sendNotification({ endpoint: t.endpoint, keys: { p256dh: t.p256dh, auth: t.auth } }, payload, {
        vapidDetails,
        TTL: 3600, // aviso de carga com mais de 1 h já não serve: o serviço descarta se o celular não aparecer antes
        urgency: "high",
        timeout: 10_000,
      });
      return r.statusCode;
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      return typeof status === "number" ? status : 0;
    }
  };
}

interface Row extends PushTarget {
  id: string;
}

/** Notificações no celular (Web Push). Sem as chaves VAPID no .env, fica desligado e não envia nada. */
export class Push {
  private readonly sender: PushSender | null;

  constructor(
    private readonly db: Db,
    config: Config,
    sender?: PushSender,
    private readonly log?: { warn: (o: object, msg: string) => void },
  ) {
    this.publicKey = config.vapidPublicKey ?? null;
    this.sender = sender ?? (config.vapidPublicKey && config.vapidPrivateKey ? webPushSender(config) : null);
  }

  readonly publicKey: string | null;

  get enabled() {
    return this.sender !== null && this.publicKey !== null;
  }

  /**
   * Para os usuários ativos da empresa que escolheram receber esse evento; devolve quantos aparelhos aceitaram.
   * Nunca lança (quem chama não espera).
   */
  async notify(tenantId: string, event: PushEvent, msg: PushMessage): Promise<number> {
    if (!this.enabled) return 0;
    try {
      const rows = await this.db.query<Row>(
        `SELECT s.id, s.endpoint, s.p256dh, s.auth FROM push_subscriptions s
         JOIN admins a ON a.id = s.admin_id AND a.disabled_at IS NULL
         LEFT JOIN push_prefs p ON p.admin_id = s.admin_id
         WHERE s.tenant_id = $3 AND $1 = ANY (COALESCE(p.events, $2::text[]))`,
        [event, PUSH_DEFAULT, tenantId],
      );
      return await this.deliver(rows.rows, msg);
    } catch (e) {
      this.log?.warn({ err: e }, "push: falha ao enviar");
      return 0;
    }
  }

  /** Para os aparelhos de um usuário (teste pela página Conta). Devolve quantos aceitaram. */
  async toAdmin(adminId: string, msg: PushMessage): Promise<{ sent: number; total: number }> {
    if (!this.enabled) return { sent: 0, total: 0 };
    const rows = await this.db.query<Row>("SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE admin_id = $1", [adminId]);
    return { sent: await this.deliver(rows.rows, msg), total: rows.rows.length };
  }

  private async deliver(rows: Row[], msg: PushMessage): Promise<number> {
    if (!rows.length || !this.sender) return 0;
    const payload = JSON.stringify({ title: msg.title, body: msg.body, url: msg.url, tag: msg.tag });
    const sender = this.sender;
    const results = await Promise.all(rows.map(async (r) => ({ r, status: await sender(r, payload).catch(() => 0) })));
    const ok = results.filter((x) => x.status >= 200 && x.status < 300).map((x) => x.r.id);
    const gone = results.filter((x) => x.status === 404 || x.status === 410).map((x) => x.r.id);
    const failed = results.filter((x) => !(x.status >= 200 && x.status < 300) && x.status !== 404 && x.status !== 410).map((x) => x.r.id);
    if (ok.length) await this.db.query("UPDATE push_subscriptions SET last_sent_at = now(), failures = 0 WHERE id = ANY ($1::bigint[])", [ok]);
    // o navegador cancelou a inscrição (desinstalou o app, bloqueou as notificações): some daqui
    if (gone.length) await this.db.query("DELETE FROM push_subscriptions WHERE id = ANY ($1::bigint[])", [gone]);
    if (failed.length) {
      await this.db.query("UPDATE push_subscriptions SET failures = failures + 1 WHERE id = ANY ($1::bigint[])", [failed]);
      await this.db.query("DELETE FROM push_subscriptions WHERE id = ANY ($1::bigint[]) AND failures >= $2", [failed, MAX_FAILURES]);
    }
    return ok.length;
  }
}
