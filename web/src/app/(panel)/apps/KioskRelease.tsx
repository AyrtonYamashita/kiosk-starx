"use client";

import { useActionToast } from "@/components/Toasts";
import { useConfirm } from "@/components/ConfirmDialog";
import { useActionState } from "react";
import { discardKiosk, publishKiosk } from "@/lib/actions";
import type { KioskRelease as KR } from "@/lib/api";
import { dateTime } from "@/lib/format";
import { UploadApk } from "./UploadApk";

/** Primeira versão que sabe se atualizar sozinha. */
const SELF_UPDATE_FROM = 5;

function size(n: number) {
  return n < 1_048_576 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1_048_576).toFixed(1).replace(".", ",")} MB`;
}

/**
 * App do kiosk: versão publicada (vai no QR e na atualização automática), versão enviada aguardando publicação
 * e quantos aparelhos estão em cada versão.
 */
export function KioskRelease({ data }: { data: KR }) {
  const ask = useConfirm();
  const [pubState, publish, publishing] = useActionState(publishKiosk, undefined);
  const [disState, discard, discarding] = useActionState(discardKiosk, undefined);
  const { release, pending } = data;
  const state = pubState ?? disState;
  useActionToast(pubState);
  useActionToast(disState);

  return (
    <div className="stack">
      {!data.autoUpdate && (
        <div className="alert warn">Atualização automática desligada no servidor (AUTO_UPDATE_APP=false): publicar só muda o APK do QR.</div>
      )}

      <dl className="kv">
        <dt>Publicada</dt>
        <dd>
          {release ? (
            <>
              <span className="mono">
                {release.versionName} ({release.versionCode})
              </span>{" "}
              <span className="badge ok">
                <span className="dot" /> no ar
              </span>
              <div className="muted small">
                {size(release.sizeBytes)} · {dateTime(release.builtAt)} · SHA-256 <span className="mono">{release.sha256.slice(0, 16)}…</span>
              </div>
            </>
          ) : (
            <span className="muted">nenhuma: envie o primeiro APK</span>
          )}
        </dd>
        <dt>Aparelhos</dt>
        <dd>
          <div className="row" style={{ gap: 8 }}>
            {data.devices.length === 0 && <span className="muted">nenhum cadastrado</span>}
            {data.devices.map((v, i) => {
              const upToDate = release && v.versionCode !== null && v.versionCode >= release.versionCode;
              const manual = v.versionCode === null || v.versionCode < SELF_UPDATE_FROM;
              return (
                <span
                  key={`${v.versionCode ?? "sem"}-${v.versionName ?? i}`}
                  className={`badge ${upToDate ? "ok" : manual ? "danger" : "warn"}`}
                  title={upToDate ? "em dia" : manual ? "versão sem atualização automática: atualize uma vez por USB, ADB ou QR" : "atualiza sozinho no próximo contato"}
                >
                  <span className="mono">{v.versionName ?? "?"}</span> · {v.devices} aparelho(s)
                  {upToDate ? " · em dia" : manual ? " · atualizar à mão" : " · atualizando"}
                </span>
              );
            })}
          </div>
        </dd>
      </dl>

      {pending && (
        <div className="card stack" style={{ background: "var(--blue-tint)", borderColor: "var(--blue-edge)" }}>
          <div className="row">
            <strong>
              Pronta para publicar:{" "}
              <span className="mono">
                {pending.versionName} ({pending.versionCode})
              </span>
            </strong>
            <span className="muted small">
              {size(pending.sizeBytes)} · enviada {dateTime(pending.builtAt)}
              {data.pendingUploadedBy ? ` por ${data.pendingUploadedBy}` : ""} · mesma assinatura da publicada
            </span>
          </div>
          <span className="small">
            Ao publicar, todos os aparelhos online com 0.4.0 ou mais nova baixam e instalam em até 30 s, sem nada na tela; o QR passa a instalar esta versão.
            Teste antes num aparelho (instalação por USB, em Cadastro).
          </span>
          <div className="row">
            <form
              action={publish}
              onSubmit={(e) => {
                ask.submit(e, { title: `Publicar a ${pending.versionName} (${pending.versionCode})?`, message: "Todos os aparelhos recebem esta versão do app no próximo contato.", confirmLabel: "Publicar" });
              }}
            >
              <button className="primary" disabled={publishing}>
                {publishing ? "Publicando…" : "Publicar para os aparelhos"}
              </button>
            </form>
            <form action={discard}>
              <button className="danger" disabled={discarding}>
                Descartar
              </button>
            </form>
          </div>
        </div>
      )}
      {state?.error && <div className="alert error">{state.error}</div>}

      <details>
        <summary className="small">Enviar versão nova do app do kiosk</summary>
        <div className="stack" style={{ marginTop: 12 }}>
          <UploadApk maxApkMb={data.maxApkMb} target="kiosk" />
          <span className="muted small">
            Gere com <span className="mono">./gradlew assembleRelease</span> (versionCode maior, keystore de release). O painel recusa APK com outra assinatura ou que
            não seja mais novo que o publicado. Enviar não publica: a versão fica aguardando o botão Publicar.
          </span>
        </div>
      </details>
    </div>
  );
}
