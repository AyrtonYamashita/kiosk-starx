"use client";

import { useActionState } from "react";
import { cancelCommand, sendCommand } from "@/lib/actions";
import type { Command, DeviceDetail, RepoApp, Screenshot } from "@/lib/api";
import { ago, commandLabel, commandStatusLabel, dateTime } from "@/lib/format";

const KIOSK_PACKAGE = "com.pstarx.kiosk";

function Feedback({ state }: { state: { ok?: string; error?: string } | undefined }) {
  if (state?.error) return <span className="alert error small">{state.error}</span>;
  if (state?.ok) return <span className="alert ok small">{state.ok}</span>;
  return null;
}

function QuickCommand({ deviceId, type, label, confirmText, danger }: { deviceId: string; type: string; label: string; confirmText?: string; danger?: boolean }) {
  const [state, action, pending] = useActionState(sendCommand, undefined);
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (confirmText && !confirm(confirmText)) e.preventDefault();
      }}
      className="row"
    >
      <input type="hidden" name="deviceId" value={deviceId} />
      <input type="hidden" name="type" value={type} />
      <button className={danger ? "danger" : undefined} disabled={pending}>
        {label}
      </button>
      <Feedback state={state} />
    </form>
  );
}

function MessageForm({ deviceId }: { deviceId: string }) {
  const [state, action, pending] = useActionState(sendCommand, undefined);
  return (
    <form action={action} className="stack">
      <input type="hidden" name="deviceId" value={deviceId} />
      <input type="hidden" name="type" value="message" />
      <label>
        Título (opcional)
        <input name="title" maxLength={80} placeholder="Aviso" />
      </label>
      <label>
        Mensagem
        <textarea name="text" maxLength={1000} required style={{ minHeight: 70 }} placeholder="Fica na tela até alguém tocar em OK." />
      </label>
      <div className="row">
        <button disabled={pending}>Enviar mensagem</button>
        <Feedback state={state} />
      </div>
    </form>
  );
}

function AppForms({ device, repo }: { device: DeviceDetail; repo: RepoApp[] }) {
  const [installState, install, installing] = useActionState(sendCommand, undefined);
  const [removeState, remove, removing] = useActionState(sendCommand, undefined);
  const removable = device.apps
    .filter((a) => !a.system && a.packageName !== KIOSK_PACKAGE)
    .sort((a, b) => (a.label ?? a.packageName).localeCompare(b.label ?? b.packageName, "pt-BR"));
  return (
    <div className="grid">
      <form action={install} className="stack">
        <input type="hidden" name="deviceId" value={device.id} />
        <input type="hidden" name="type" value="install_app" />
        <label>
          Instalar / atualizar app do repositório
          <select name="app" required defaultValue="">
            <option value="" disabled>
              {repo.length ? "Escolha…" : "Repositório vazio (menu Apps)"}
            </option>
            {repo.map((a) => (
              <optgroup key={a.packageName} label={a.label}>
                {a.versions.map((v, i) => (
                  <option key={v.id} value={`${a.packageName}@${v.versionCode}`}>
                    {a.label} {v.versionName ?? ""} ({v.versionCode}){i === 0 ? " — mais nova" : ""}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <div className="row">
          <button disabled={installing || !repo.length}>Instalar</button>
          <Feedback state={installState} />
        </div>
        <span className="muted small">Instala sem pedir nada na tela. Uma versão mais velha que a instalada é ignorada.</span>
      </form>
      <form
        action={remove}
        onSubmit={(e) => {
          if (!confirm("Remover o app deste aparelho? Os dados do app são apagados.")) e.preventDefault();
        }}
        className="stack"
      >
        <input type="hidden" name="deviceId" value={device.id} />
        <input type="hidden" name="type" value="uninstall_app" />
        <label>
          Remover app instalado
          <select name="packageName" required defaultValue="">
            <option value="" disabled>
              Escolha…
            </option>
            {removable.map((a) => (
              <option key={a.packageName} value={a.packageName}>
                {a.label ?? a.packageName} ({a.packageName})
              </option>
            ))}
          </select>
        </label>
        <div className="row">
          <button className="danger" disabled={removing || !removable.length}>
            Remover
          </button>
          <Feedback state={removeState} />
        </div>
      </form>
    </div>
  );
}

function detail(c: Command): string {
  switch (c.type) {
    case "message":
      return [c.payload?.title, c.payload?.text].filter(Boolean).join(": ");
    case "install_app":
      return `${c.payload?.packageName} (${c.payload?.artifact?.versionCode ?? "?"})`;
    case "uninstall_app":
      return c.payload?.packageName ?? "";
    default:
      return "";
  }
}

export function DeviceCommands({ device, commands, screenshots, repo }: { device: DeviceDetail; commands: Command[]; screenshots: Screenshot[]; repo: RepoApp[] }) {
  const latest = screenshots[0];
  const oldAppVersion = (device.appVersionCode ?? 0) < 5;
  return (
    <div className="stack">
      {oldAppVersion && (
        <div className="alert warn small">
          O app do aparelho ({device.appVersion ?? "versão desconhecida"}) ainda não entende comandos: eles ficam esperando até expirar. Atualize para a 0.4.0 ou mais nova
          (uma vez por ADB ou QR; depois disso o app se atualiza sozinho).
        </div>
      )}
      <div className="row">
        <QuickCommand deviceId={device.id} type="lock" label="Bloquear tela" />
        <QuickCommand deviceId={device.id} type="reload" label="Recarregar kiosk" />
        <QuickCommand deviceId={device.id} type="screenshot" label="Capturar tela" />
        <QuickCommand deviceId={device.id} type="reboot" label="Reiniciar" danger confirmText={`Reiniciar "${device.name}"?`} />
      </div>
      <span className="muted small">
        Os comandos chegam no próximo contato do aparelho (até 30 s). Recarregar: o site volta à página inicial; no modo app único, o app é fechado e aberto de novo. A captura
        mostra só a tela do kiosk (grade, site ou configurações): com outro app na frente, o Android não deixa capturar sem confirmação no aparelho.
      </span>

      {latest && (
        <div className="stack">
          <strong className="small">
            Última captura · {dateTime(latest.createdAt)} ({ago(latest.createdAt)})
          </strong>
          <a href={`/screenshots/${latest.id}`} target="_blank" rel="noreferrer">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/screenshots/${latest.id}`}
              alt={`Tela de ${device.name}`}
              style={{ maxHeight: 420, maxWidth: "100%", border: "1px solid var(--border)", borderRadius: 8 }}
            />
          </a>
          {screenshots.length > 1 && (
            <div className="row small">
              Anteriores:
              {screenshots.slice(1).map((s) => (
                <a key={s.id} href={`/screenshots/${s.id}`} target="_blank" rel="noreferrer">
                  {dateTime(s.createdAt)}
                </a>
              ))}
            </div>
          )}
        </div>
      )}

      <details>
        <summary className="small">Mensagem na tela</summary>
        <div style={{ marginTop: 8 }}>
          <MessageForm deviceId={device.id} />
        </div>
      </details>

      <details>
        <summary className="small">Instalar ou remover app</summary>
        <div style={{ marginTop: 8 }}>
          <AppForms device={device} repo={repo} />
        </div>
      </details>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Comando</th>
              <th>Situação</th>
              <th className="hide-sm">Enviado</th>
            </tr>
          </thead>
          <tbody>
            {commands.length === 0 && (
              <tr>
                <td colSpan={3} className="muted">
                  Nenhum comando ainda.
                </td>
              </tr>
            )}
            {commands.map((c) => {
              const [cls, label] = commandStatusLabel[c.status];
              return (
                <tr key={c.id}>
                  <td>
                    <strong>{commandLabel[c.type] ?? c.type}</strong>
                    {detail(c) && <div className="muted small">{detail(c)}</div>}
                  </td>
                  <td>
                    <span className={`badge ${cls}`}>{label}</span>
                    {c.message && <div className="small">{c.message}</div>}
                    {c.output?.screenshotId && (
                      <a className="small" href={`/screenshots/${c.output.screenshotId}`} target="_blank" rel="noreferrer">
                        ver imagem
                      </a>
                    )}
                    {c.status === "pending" && (
                      <form action={cancelCommand}>
                        <input type="hidden" name="id" value={c.id} />
                        <input type="hidden" name="deviceId" value={device.id} />
                        <button className="link-button small">cancelar</button>
                      </form>
                    )}
                  </td>
                  <td className="hide-sm small">
                    {dateTime(c.createdAt)}
                    <div className="muted">
                      {c.createdBy ?? ""}
                      {c.doneAt ? ` · concluído ${ago(c.doneAt)}` : c.status === "sent" || c.status === "pending" ? ` · expira ${dateTime(c.expiresAt)}` : ""}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Apps que o perfil mantém no aparelho e a situação de cada um. */
export function ManagedAppsStatus({ device, repo }: { device: DeviceDetail; repo: RepoApp[] }) {
  if (device.managedApps.length === 0) {
    return <span className="muted small">O perfil deste aparelho não tem apps gerenciados (edite o perfil para incluir apps do repositório).</span>;
  }
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>App</th>
            <th>No aparelho</th>
            <th>Mais nova</th>
          </tr>
        </thead>
        <tbody>
          {device.managedApps.map((pkg) => {
            const r = repo.find((a) => a.packageName === pkg);
            const latest = r?.versions[0];
            const installed = device.apps.find((a) => a.packageName === pkg);
            const st = device.managedStatus[pkg];
            const upToDate = installed?.versionCode !== undefined && latest && installed.versionCode >= latest.versionCode;
            return (
              <tr key={pkg}>
                <td>
                  {r?.label ?? pkg}
                  <div className="muted small mono">{pkg}</div>
                </td>
                <td>
                  {installed ? (
                    <>
                      {installed.versionName ?? "?"} ({installed.versionCode ?? "?"}) {upToDate ? <span className="badge ok">em dia</span> : <span className="badge warn">atualizando</span>}
                    </>
                  ) : (
                    <span className="badge warn">instalando</span>
                  )}
                  {st?.error && <div className="alert error small">{st.error}</div>}
                </td>
                <td className="small">{latest ? `${latest.versionName ?? ""} (${latest.versionCode})` : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
