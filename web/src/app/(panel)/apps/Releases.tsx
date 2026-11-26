"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { useConfirm } from "@/components/ConfirmDialog";
import { useActionToast } from "@/components/Toasts";
import { cancelReleaseSchedule, clearReleasePilot, discardKioskVersion, publishRelease } from "@/lib/actions";
import type { ReleaseChannel, ReleaseKind, Releases as R } from "@/lib/api";
import { dateTime } from "@/lib/format";
import { UploadApk } from "./UploadApk";

/*
  Versões do app do kiosk e do leitor do SSW, em três etapas:
    1. Enviada: está no servidor, não chega a nenhum coletor.
    2. Pilotos: só os coletores marcados como piloto recebem (teste em produção).
    3. Todos: todos os coletores recebem; o teste acaba (os pilotos voltam a seguir todos).
  Cada publicação pode ser agora ou agendada. Nada recarrega um coletor com carga aberta: ele recebe quando a carga fecha.
*/

const CHANNEL_LABEL: Record<ReleaseChannel, string> = { pilot: "os pilotos", all: "todos" };

function size(n: number) {
  return n < 1_048_576 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1_048_576).toFixed(1).replace(".", ",")} MB`;
}

type Schedule = R["schedules"][number];

function pendingSchedules(data: R, kind: ReleaseKind) {
  return data.schedules.filter((s) => s.kind === kind && !s.doneAt);
}

/** Publicar para os pilotos ou todos: agora ou numa data e hora. */
function PublishForm({ kind, refValue, label, channel, primary }: { kind: ReleaseKind; refValue: string; label: string; channel: ReleaseChannel; primary?: boolean }) {
  const ask = useConfirm();
  const [state, action, pending] = useActionState(publishRelease, undefined);
  const [when, setWhen] = useState<"now" | "later">("now");
  const [local, setLocal] = useState("");
  const [err, setErr] = useState("");
  useActionToast(state);
  const who = CHANNEL_LABEL[channel];
  return (
    <form
      action={action}
      className="release-publish"
      onSubmit={(e) => {
        const form = e.currentTarget;
        const at = form.elements.namedItem("at") as HTMLInputElement;
        if (when === "later") {
          const d = new Date(local);
          if (!local || Number.isNaN(d.getTime()) || d.getTime() <= Date.now()) {
            e.preventDefault();
            setErr("Escolha uma data e hora no futuro.");
            return;
          }
          at.value = d.toISOString();
        } else at.value = "";
        setErr("");
        const message =
          channel === "pilot"
            ? "Só os coletores marcados como piloto recebem esta versão. Os outros continuam na de todos."
            : "Todos os coletores recebem esta versão. Quem estiver com uma carga aberta recebe quando ela fechar.";
        ask.submit(e, {
          title: when === "later" ? `Agendar ${label} para ${who} em ${new Date(local).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}?` : `Publicar ${label} para ${who} agora?`,
          message,
          confirmLabel: when === "later" ? "Agendar" : "Publicar",
        });
      }}
    >
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="channel" value={channel} />
      <input type="hidden" name="ref" value={refValue} />
      <input type="hidden" name="label" value={label} />
      <input type="hidden" name="at" value="" />
      <div className="segmented small" role="radiogroup" aria-label="Quando">
        <label>
          <input type="radio" checked={when === "now"} onChange={() => setWhen("now")} /> agora
        </label>
        <label>
          <input type="radio" checked={when === "later"} onChange={() => setWhen("later")} /> agendar
        </label>
      </div>
      {when === "later" && <input type="datetime-local" value={local} onChange={(e) => setLocal(e.target.value)} aria-label="Data e hora" required />}
      <button className={primary ? "primary" : undefined} disabled={pending}>
        {pending ? "Enviando…" : when === "later" ? `Agendar para ${who}` : `Publicar para ${who}`}
      </button>
      {err && <span className="alert error">{err}</span>}
      {state?.error && <span className="alert error">{state.error}</span>}
    </form>
  );
}

function CancelSchedule({ s }: { s: Schedule }) {
  const [state, action, pending] = useActionState(cancelReleaseSchedule, undefined);
  useActionToast(state);
  return (
    <form action={action}>
      <input type="hidden" name="id" value={s.id} />
      <button className="link-button" disabled={pending}>
        cancelar
      </button>
    </form>
  );
}

function ScheduleList({ items, label }: { items: Schedule[]; label: (ref: string) => string }) {
  if (!items.length) return null;
  return (
    <ul className="release-schedules">
      {items.map((s) => (
        <li key={s.id}>
          <span className="badge warn">
            <span className="dot" /> agendada
          </span>
          <span className="small">
            <strong className="mono">{label(s.ref)}</strong> para {CHANNEL_LABEL[s.channel]} em <span className="mono">{dateTime(s.runAt)}</span>
            {s.createdBy ? <span className="muted"> · por {s.createdBy}</span> : null}
          </span>
          <CancelSchedule s={s} />
        </li>
      ))}
    </ul>
  );
}

function ClearPilot({ kind }: { kind: ReleaseKind }) {
  const ask = useConfirm();
  const [state, action, pending] = useActionState(clearReleasePilot, undefined);
  useActionToast(state);
  return (
    <form
      action={action}
      onSubmit={(e) =>
        ask.submit(e, {
          title: "Encerrar o teste nos pilotos?",
          message:
            kind === "kiosk"
              ? "Os pilotos deixam de receber a versão de teste. Quem já instalou fica nela até a versão de todos passar à frente (o Android não instala versão mais velha)."
              : "Os pilotos voltam ao leitor de todos no próximo contato (e depois de fechar uma carga aberta).",
          confirmLabel: "Encerrar teste",
        })
      }
    >
      <input type="hidden" name="kind" value={kind} />
      <button className="link-button" disabled={pending}>
        encerrar teste
      </button>
    </form>
  );
}

function Discard({ code, label }: { code: number; label: string }) {
  const ask = useConfirm();
  const [state, action, pending] = useActionState(discardKioskVersion, undefined);
  useActionToast(state);
  return (
    <form action={action} onSubmit={(e) => ask.submit(e, { title: `Descartar ${label}?`, message: "O APK sai do servidor. Ela nunca chegou a nenhum coletor.", confirmLabel: "Descartar", danger: true })}>
      <input type="hidden" name="code" value={code} />
      <button className="danger" disabled={pending}>
        Descartar
      </button>
    </form>
  );
}

/** Onde está cada grupo agora: todos e pilotos. */
function Channels({ all, pilot, pilots, allDevices, pilotDevices, kind }: { all: string; pilot: string | null; pilots: number; allDevices?: number; pilotDevices?: number; kind: ReleaseKind }) {
  return (
    <div className="release-channels">
      <div>
        <span className="section-label">Todos os coletores</span>
        <strong className="mono">{all}</strong>
        {allDevices !== undefined && <span className="muted small">{allDevices} coletor(es) nesta versão</span>}
      </div>
      <div>
        <span className="section-label">Pilotos ({pilots})</span>
        {pilot ? (
          <>
            <strong className="mono">{pilot}</strong>
            <span className="muted small">
              em teste{pilotDevices !== undefined ? ` · ${pilotDevices} coletor(es) nela` : ""}
            </span>
          </>
        ) : (
          <span className="muted small">{pilots ? "seguem a versão de todos" : "nenhum coletor piloto"}</span>
        )}
      </div>
      {pilot && (
        <div className="release-channels-action">
          <ClearPilot kind={kind} />
        </div>
      )}
    </div>
  );
}

function Stage({ stage }: { stage: "all" | "pilot" | "sent" | "old" }) {
  if (stage === "all")
    return (
      <span className="badge ok">
        <span className="dot" /> todos
      </span>
    );
  if (stage === "pilot")
    return (
      <span className="badge blue">
        <span className="dot" /> pilotos
      </span>
    );
  if (stage === "sent")
    return (
      <span className="badge off">
        <span className="dot" /> enviada, não publicada
      </span>
    );
  return (
    <span className="badge off">
      <span className="dot" /> anterior
    </span>
  );
}

function Reversible({ value, note }: { value: boolean | null; note: string | null }) {
  return (
    <div className="release-reversible">
      {value === true && (
        <span className="badge ok">
          <span className="dot" /> pode voltar
        </span>
      )}
      {value === false && (
        <span className="badge danger">
          <span className="dot" /> não pode voltar
        </span>
      )}
      {value === null && (
        <span className="badge off">
          <span className="dot" /> volta não informada
        </span>
      )}
      {note && <span className="muted small">{note}</span>}
    </div>
  );
}

/** App do kiosk: etapas, versões (o que muda e se pode voltar), publicar para pilotos ou todos, agendar. */
export function KioskVersions({ data, canPublish, maxApkMb, autoUpdate }: { data: R; canPublish: boolean; maxApkMb: number; autoUpdate: boolean }) {
  const { kiosk } = data;
  const pilots = data.devices.filter((d) => d.pilot);
  const byCode = new Map(kiosk.versions.map((v) => [v.versionCode, v]));
  const label = (code: string | number | null) => {
    if (code === null) return "—";
    const v = byCode.get(Number(code));
    return v ? `${v.versionName} (${v.versionCode})` : String(code);
  };
  const scheduled = pendingSchedules(data, "kiosk");
  const allV = kiosk.all;
  return (
    <div className="stack">
      {!autoUpdate && <div className="alert warn">Atualização automática desligada no servidor (AUTO_UPDATE_APP=false): publicar só muda o APK do QR.</div>}
      <Channels
        kind="kiosk"
        all={allV ? label(allV) : "nenhuma publicada"}
        pilot={kiosk.pilot ? label(kiosk.pilot) : null}
        pilots={pilots.length}
        allDevices={allV ? byCode.get(allV)?.devices : undefined}
        pilotDevices={kiosk.pilot ? byCode.get(kiosk.pilot)?.devices : undefined}
      />
      <ScheduleList items={scheduled} label={label} />

      {/* passo 1, à vista: enviar o APK (a versão entra na lista abaixo como "enviada") */}
      {canPublish && (
        <div className="release-upload">
          <div className="release-upload-head">
            <strong className="small">Enviar versão nova do app</strong>
            <span className="muted small">
              APK de release (<span className="mono">assembleRelease</span>, versionCode maior). As notas e o &quot;pode voltar&quot; vêm de dentro do APK. Enviar não
              publica: a versão aparece abaixo como &quot;enviada&quot;.
            </span>
          </div>
          <UploadApk maxApkMb={maxApkMb} target="kiosk" />
        </div>
      )}

      <ol className="release-list">
        {kiosk.versions.map((v) => {
          const stage = v.versionCode === kiosk.all ? "all" : v.versionCode === kiosk.pilot ? "pilot" : allV !== null && v.versionCode < allV ? "old" : "sent";
          const ahead = allV === null || v.versionCode > allV;
          const name = `${v.versionName} (${v.versionCode})`;
          return (
            <li key={v.versionCode} className={`release-item ${stage}`}>
              <div className="release-head">
                <strong className="mono">{name}</strong>
                <Stage stage={stage} />
                {scheduled
                  .filter((s) => s.ref === String(v.versionCode))
                  .map((s) => (
                    <span key={s.id} className="badge warn">
                      <span className="dot" /> {CHANNEL_LABEL[s.channel]} em {dateTime(s.runAt)}
                    </span>
                  ))}
                <span className="spacer" />
                <span className="muted small">
                  {size(v.sizeBytes)} · enviada {dateTime(v.uploadedAt)}
                  {v.uploadedBy ? ` por ${v.uploadedBy}` : ""} · {v.devices} coletor(es)
                </span>
              </div>
              {v.notes.length > 0 ? (
                <ul className="release-notes">
                  {v.notes.map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
              ) : (
                <span className="muted small">Sem notas no APK.</span>
              )}
              <Reversible value={v.reversible} note={v.reversibleNote} />
              {canPublish && ahead && (
                <div className="release-actions">
                  {stage !== "pilot" && <PublishForm kind="kiosk" refValue={String(v.versionCode)} label={name} channel="pilot" />}
                  <PublishForm kind="kiosk" refValue={String(v.versionCode)} label={name} channel="all" primary={stage === "pilot"} />
                  {stage === "sent" && <Discard code={v.versionCode} label={name} />}
                </div>
              )}
            </li>
          );
        })}
        {kiosk.versions.length === 0 && <li className="muted">Nenhuma versão enviada ainda.</li>}
      </ol>

    </div>
  );
}

/** Leitor do SSW: chega com o deploy da API e só vai aos coletores quando publicado (pilotos ou todos). */
export function ReaderVersions({ data, canPublish }: { data: R; canPublish: boolean }) {
  const { reader } = data;
  const pilots = data.devices.filter((d) => d.pilot);
  const byRef = new Map(reader.versions.map((v) => [v.sha256, v]));
  const label = (sha: string | null) => {
    if (!sha) return "—";
    const v = byRef.get(sha);
    return v?.version ?? sha.slice(0, 10);
  };
  const scheduled = pendingSchedules(data, "reader");
  return (
    <div className="stack">
      <Channels kind="reader" all={label(reader.all)} pilot={reader.pilot ? label(reader.pilot) : null} pilots={pilots.length} />
      <ScheduleList items={scheduled} label={label} />
      <ol className="release-list">
        {reader.versions.map((v) => {
          const stage = v.sha256 === reader.all ? "all" : v.sha256 === reader.pilot ? "pilot" : v.firstSeenAt < (byRef.get(reader.all ?? "")?.firstSeenAt ?? "") ? "old" : "sent";
          const name = `leitor ${v.version ?? v.sha256.slice(0, 10)}`;
          return (
            <li key={v.sha256} className={`release-item ${stage}`}>
              <div className="release-head">
                <strong className="mono">{v.version ?? v.sha256.slice(0, 10)}</strong>
                <Stage stage={stage} />
                {v.sha256 === reader.deployed && <span className="badge off">no deploy atual</span>}
                <span className="spacer" />
                <span className="muted small">
                  chegou com o deploy de {dateTime(v.firstSeenAt)} · <span className="mono">{v.sha256.slice(0, 10)}</span>
                </span>
              </div>
              {canPublish && stage !== "all" && (
                <div className="release-actions">
                  {stage !== "pilot" && <PublishForm kind="reader" refValue={v.sha256} label={name} channel="pilot" />}
                  <PublishForm kind="reader" refValue={v.sha256} label={name} channel="all" primary={stage === "pilot"} />
                </div>
              )}
            </li>
          );
        })}
      </ol>
      <span className="muted small">
        O leitor entra na página do SSW sem atualizar o app. Um leitor novo vem junto com o deploy da API e só chega aos coletores quando é publicado aqui. Pode
        voltar sempre: publique de novo um leitor anterior.
      </span>
    </div>
  );
}

/** Coletores piloto (marcados na página de cada coletor). */
export function PilotDevices({ data }: { data: R }) {
  const pilots = data.devices.filter((d) => d.pilot);
  return (
    <div className="stack" style={{ gap: 10 }}>
      {pilots.length === 0 ? (
        <span className="muted small">Nenhum coletor piloto. Marque um na página do coletor, aba &quot;SSW e piloto&quot;.</span>
      ) : (
        <div className="row" style={{ gap: 8 }}>
          {pilots.map((d) => (
            <Link key={d.id} href={`/devices/${d.id}`} className="badge blue">
              <span className="dot" /> {d.name}
              {d.tenant ? ` · ${d.tenant}` : ""} · <span className="mono">{d.appVersion ?? "?"}</span>
            </Link>
          ))}
        </div>
      )}
      <span className="muted small">
        Pilotos recebem primeiro o que for publicado &quot;para os pilotos&quot; (app do kiosk e leitor do SSW). Os outros coletores só recebem quando a versão for
        publicada para todos.
      </span>
    </div>
  );
}
