import Link from "next/link";
import { ApiError, api, type OpsDetail } from "@/lib/api";
import { CODE_KIND, END_LABEL, fmtClock, fmtDuration, fmtQty, fmtTime, SCREEN_LABEL } from "@/lib/opsFormat";
import { notFound } from "next/navigation";
import { Num } from "@/components/Num";
import { Elapsed, LiveDetail } from "./LiveDetail";

export const dynamic = "force-dynamic";

export default async function OpsDetailPage({ params, searchParams }: { params: Promise<{ deviceId: string }>; searchParams: Promise<{ op?: string }> }) {
  const { deviceId } = await params;
  const { op: opId } = await searchParams;
  let d: OpsDetail;
  try {
    d = await api<OpsDetail>(`/v1/admin/ops/devices/${encodeURIComponent(deviceId)}${opId ? `?op=${encodeURIComponent(opId)}` : ""}`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
  const op = d.operation;
  const open = op && !op.endedAt;
  const user = op?.user ?? d.card?.user ?? null;
  const pct = op && op.total.qty > 0 ? Math.min(100, (op.read.qty / op.total.qty) * 100) : 0;

  return (
    <div className="stack wide">
      <div className="row">
        <Link href="/operations" className="link-button" transitionTypes={["nav-back"]}>
          ← Acompanhamento
        </Link>
      </div>
      <div className="row">
        <h1 style={{ margin: 0 }}>{user ?? "Sem colaborador"}</h1>
        <LiveDetail deviceId={d.device.id} />
        <span className="spacer" />
        <span className="muted small">
          coletor <Link href={`/devices/${d.device.id}`} className="mono">{d.device.name}</Link>
          {op?.branch ? ` · filial ${op.branch}` : ""}
        </span>
      </div>

      {!op ? (
        <div className="card muted">
          Nenhuma descarga registrada neste coletor{d.card?.user ? ` — ${d.card.user} está ${SCREEN_LABEL[d.card.screen ?? ""] ?? "logado"}` : ""}.
        </div>
      ) : (
        <>
          <p className="ops-sentence" style={{ fontSize: 15, margin: 0 }}>
            {open ? (
              <>
                <b>{user ?? "Alguém"}</b> está na função <b>{op.fnLabel}</b> agora, no carro <b className="mono">{op.realPlate || op.plate}</b>
              </>
            ) : (
              <>
                {op.fnLabel} do carro <b className="mono">{op.realPlate || op.plate}</b> — {END_LABEL[op.endReason ?? ""] ?? "encerrada"} às {fmtTime(op.endedAt)}
                {!opId ? "" : " "}
                {opId && (
                  <Link href={`/operations/${d.device.id}`} className="link-button">
                    ver a carga atual
                  </Link>
                )}
              </>
            )}
          </p>

          <div className="grid" style={{ alignItems: "start" }}>
            <section className="card stack">
              <div className="row" style={{ justifyContent: "space-between" }}>
                <h2>Carga</h2>
                <Num value={Math.round(pct)} suffix="%" className="ops-pct" />
              </div>
              <div className="ops-bar" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label="volumes lidos">
                <span style={{ width: `${pct}%` }} />
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th />
                      <th style={{ textAlign: "right" }}>Total</th>
                      <th style={{ textAlign: "right" }}>Lidos</th>
                      <th style={{ textAlign: "right" }}>Faltam</th>
                    </tr>
                  </thead>
                  <tbody className="mono">
                    <tr>
                      <td className="sans">Volumes</td>
                      <td style={{ textAlign: "right" }}><Num value={op.total.qty} /></td>
                      <td style={{ textAlign: "right" }} className="good"><Num value={op.read.qty} /></td>
                      <td style={{ textAlign: "right" }} className={op.missing.qty ? "bad" : ""}><Num value={op.missing.qty} /></td>
                    </tr>
                    <tr>
                      <td className="sans">Peso</td>
                      <td style={{ textAlign: "right" }}><Num value={op.total.kg} decimals={1} suffix=" kg" /></td>
                      <td style={{ textAlign: "right" }} className="good"><Num value={op.read.kg} decimals={1} suffix=" kg" /></td>
                      <td style={{ textAlign: "right" }} className={op.missing.kg ? "bad" : ""}><Num value={op.missing.kg} decimals={1} suffix=" kg" /></td>
                    </tr>
                    <tr>
                      <td className="sans">Valor</td>
                      <td style={{ textAlign: "right" }}><Num value={op.total.value} decimals={2} prefix="R$ " /></td>
                      <td style={{ textAlign: "right" }} className="good"><Num value={op.read.value} decimals={2} prefix="R$ " /></td>
                      <td style={{ textAlign: "right" }} className={op.missing.value ? "bad" : ""}><Num value={op.missing.value} decimals={2} prefix="R$ " /></td>
                    </tr>
                  </tbody>
                </table>
              </div>
              {op.units.length > 0 && <span className="muted small">Filiais: {op.units.join(" · ")}</span>}
            </section>

            <section className="card stack">
              <h2>Tempos</h2>
              <dl className="kv">
                <dt>Tempo na função hoje</dt>
                <dd className="mono">
                  {d.functionTimeTodaySec === null ? "—" : open ? <Elapsed since={new Date(d.serverTime).toISOString()} serverTime={d.serverTime} extraSec={d.functionTimeTodaySec} /> : fmtDuration(d.functionTimeTodaySec)}
                </dd>
                <dt>Tempo desta carga</dt>
                <dd className="mono">
                  {open ? <Elapsed since={op.startedAt} serverTime={d.serverTime} /> : fmtDuration((new Date(op.endedAt!).getTime() - new Date(op.startedAt).getTime()) / 1000)}
                  <span className="muted"> · desde {fmtTime(op.startedAt)}</span>
                </dd>
                <dt>Tempo médio por volume</dt>
                <dd className="mono">{op.avgSecPerVolume !== null ? <Num value={op.avgSecPerVolume} decimals={1} suffix=" s" /> : "—"}</dd>
                <dt>Volumes bipados</dt>
                <dd className="mono">
                  <Num value={op.scans} />
                  <span className="muted"> · último às {fmtClock(op.lastScanAt)}</span>
                </dd>
                <dt>Estimativa de término</dt>
                <dd className="mono">
                  {!open ? "—" : op.missing.qty === 0 ? "todos os volumes lidos" : op.etaAt ? `~${fmtTime(op.etaAt)}` : "aguardando bipagens"}
                </dd>
              </dl>
              <span className="muted small">
                A estimativa usa o tempo médio por volume desta carga, a partir da última bipagem.
              </span>
            </section>
          </div>

          <div className="grid" style={{ alignItems: "start" }}>
            <section className="card stack">
              <h2>
                Bipagens (<Num value={d.scans.length} />)
              </h2>
              {d.scans.length === 0 ? (
                <span className="muted small">Nenhuma bipagem ainda.</span>
              ) : (
                <div className="table-wrap" style={{ maxHeight: 360, overflowY: "auto" }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Hora</th>
                        <th style={{ textAlign: "right" }}>Lidos</th>
                        <th style={{ textAlign: "right" }}>Intervalo</th>
                      </tr>
                    </thead>
                    <tbody className="mono">
                      {d.scans.map((s) => (
                        <tr key={s.at}>
                          <td>{fmtClock(s.at)}</td>
                          <td style={{ textAlign: "right" }}>
                            {fmtQty(s.qty)}
                            {s.delta > 1 && <span className="muted"> (+{s.delta})</span>}
                          </td>
                          <td style={{ textAlign: "right" }}>{s.intervalSec === null ? "—" : `${s.intervalSec.toLocaleString("pt-BR")} s`}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="card stack">
              <h2>Cargas de hoje neste coletor ({d.today.length})</h2>
              {d.today.length === 0 ? (
                <span className="muted small">Nenhuma carga hoje.</span>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Carro</th>
                        <th>Início</th>
                        <th style={{ textAlign: "right" }}>Duração</th>
                        <th style={{ textAlign: "right" }}>Volumes</th>
                        <th>Situação</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.today.map((o) => (
                        <tr key={o.id} className={o.id === op.id ? "selected" : undefined}>
                          <td>
                            <Link href={`/operations/${d.device.id}?op=${o.id}`} className="mono">
                              {o.plate}
                            </Link>
                            <div className="muted small">
                              {o.fnLabel.replace("Descarga de ", "")}
                              {o.user ? ` · ${o.user}` : ""}
                            </div>
                          </td>
                          <td className="mono">{fmtTime(o.startedAt)}</td>
                          <td className="mono" style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                            {fmtDuration(o.durationSec)}
                          </td>
                          <td className="mono" style={{ textAlign: "right" }}>
                            {fmtQty(o.readQty)}/{fmtQty(o.totalQty)}
                          </td>
                          <td>
                            {o.endedAt ? (
                              <span className={`badge ${o.endReason === "concluded" ? "ok" : "off"}`}>
                                <span className="dot" /> {END_LABEL[o.endReason ?? ""] ?? "encerrada"}
                              </span>
                            ) : (
                              <span className="badge blue">
                                <span className="dot" /> em andamento
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>

            <section className="card stack">
              <h2>
                Códigos bipados (<Num value={d.codes?.length ?? 0} />)
              </h2>
              {!d.codes?.length ? (
                <span className="muted small">
                  Nenhum código registrado nesta carga. Os códigos aparecem a partir do app 0.5.2 e ficam guardados por 1 ano; para achar um
                  código em qualquer carga, use a <Link href="/operations/codigo">consulta por código de barras</Link>.
                </span>
              ) : (
                <div className="table-wrap" style={{ maxHeight: 360, overflowY: "auto" }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Hora</th>
                        <th>Código</th>
                        <th>Tipo</th>
                        <th style={{ textAlign: "right" }}>Lidos</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.codes.map((c, i) => {
                        const [cls, label] = CODE_KIND[c.kind] ?? ["off", c.kind];
                        return (
                          <tr key={`${c.at}-${i}`}>
                            <td className="mono">{fmtClock(c.at)}</td>
                            <td className="mono">
                              <Link href={`/operations/codigo?code=${encodeURIComponent(c.code)}`}>{c.code}</Link>
                            </td>
                            <td>
                              <span className={`badge ${cls}`}>
                                <span className="dot" /> {label}
                              </span>
                            </td>
                            <td className="mono" style={{ textAlign: "right" }}>
                              {c.readQty === null ? "—" : fmtQty(c.readQty)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
        </>
      )}
    </div>
  );
}
