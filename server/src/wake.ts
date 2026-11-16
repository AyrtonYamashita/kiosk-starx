/**
 * Aviso imediato aos aparelhos (long polling): o aparelho fica esperando em GET /v1/device/wait; quando o painel
 * cria um comando ou muda a configuração dele, a espera termina na hora e o aparelho faz o check-in.
 * Em memória: a API roda numa instância só. Com várias, troque por LISTEN/NOTIFY do Postgres.
 */
export class Waker {
  private waiters = new Map<string, Set<(woken: boolean) => void>>();

  /** Espera um aviso para o aparelho (true) ou o tempo acabar / a conexão cair (false). */
  wait(deviceId: string, ms: number, signal?: AbortSignal): Promise<boolean> {
    return new Promise((resolve) => {
      let set = this.waiters.get(deviceId);
      if (!set) this.waiters.set(deviceId, (set = new Set()));
      const done = (woken: boolean) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        set!.delete(done);
        if (set!.size === 0) this.waiters.delete(deviceId);
        resolve(woken);
      };
      const onAbort = () => done(false);
      const timer = setTimeout(() => done(false), ms);
      signal?.addEventListener("abort", onAbort);
      set.add(done);
    });
  }

  wake(deviceIds: Iterable<string>) {
    for (const id of deviceIds) {
      const set = this.waiters.get(id);
      if (set) for (const done of [...set]) done(true);
    }
  }

  /** Aparelhos esperando agora (para o painel e os testes). */
  waiting(deviceId: string): number {
    return this.waiters.get(deviceId)?.size ?? 0;
  }
}
