import Link from "next/link";
import { notFound } from "next/navigation";
import { Num } from "@/components/Num";
import { UnderlineTabs } from "@/components/UnderlineTabs";
import { ApiError, api, type OpsDetail } from "@/lib/api";
import { CODE_KIND, END_LABEL, fmtClock, fmtDuration, fmtQty, fmtTime, SCREEN_LABEL } from "@/lib/opsFormat";
import { Elapsed, Eta, LiveDetail, SinceClock } from "./LiveDetail";
import { ProgressChart } from "./ProgressChart";

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
  const open = !!op && !op.endedAt;
  const user = op?.user ?? d.card?.user ?? null;
  const pct = op && op.total.qty > 0 ? Math.min(100, (op.read.qty / op.total.qty) * 100) : 0;

  return (
    <div className="stack wide ops-detail">
      <Link href="/operations" className="link-button" transitionTypes={["nav-back"]}>
        ← Acompanhamento
      </Link>

      <header className="ops-detail-head">
        <div className="row" style={{ gap: 10 }}>
          <h1 style={{ margin: 0 }}>{user ?? "Sem colaborador"}</h1>
          <LiveDetail deviceId={d.device.id} />
        </div>
        <div className="ops-detail-meta">
          {op && (
            <>
              <span className="ops-fn-label">{op.fnLabel}</span>
              <span className="ops-plate mono">{op.realPlate || op.plate}</span>
              {open ? (
                <span className="badge ok">
                  <span className="dot" /> em andamento
                </span>
              ) : (
                <span className={`badge ${op.endReason === "concluded" ? "ok" : "off"}`}>
                  <span className="dot" /> {END_LABEL[op.endReason ?? ""] ?? "encerrada"} às {fmtTime(op.endedAt)}
                </span>
              )}
              {opId && (
                <Link href={`/operations/${d.device.id}`} className="link-button small">
                  ver a carga atual
                </Link>
              )}
            </>
          )}
          <span className="spacer" />
          <span className="muted small">
            coletor{" "}
            <Link href={`/devices/${d.device.id}`} className="mono">
              {d.device.name}
            </Link>
            {op?.branch ? ` · filial ${op.branch}` : ""}
          </span>
        </div>
      </header>

      {!op ? (
        <div className="card muted">
          Nenhuma carga registrada neste coletor{d.card?.user ? ` — ${d.card.user} está ${SCREEN_LABEL[d.card.screen ?? ""] ?? "logado"}` : ""}.
        </div>
      ) : (
        <>
          <div className="ops-detail-top">
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

            <section className="ops-tiles" aria-label="Tempos">
              <div className="card ops-tile">
                <span className="section-label">Tempo desta carga</span>
                <strong className="ops-tile-main mono">
                  {open ? <Elapsed since={op.startedAt} serverTime={d.serverTime} /> : fmtDuration((new Date(op.endedAt!).getTime() - new Date(op.startedAt).getTime()) / 1000)}
                </strong>
                <span className="muted small">desde {fmtTime(op.startedAt)}</span>
              </div>
              <div className="card ops-tile">
                <span className="section-label">Ritmo</span>
                <strong className="ops-tile-main mono">
                  {op.avgSecPerVolume !== null ? <Num value={op.avgSecPerVolume} decimals={1} suffix=" s/vol" /> : "—"}
                </strong>
                <span className="muted small">
                  <Num value={op.scans} /> bipagens
                </span>
              </div>
              <div className="card ops-tile">
                <span className="section-label">Término</span>
                <strong className="ops-tile-main mono">
                  {!open ? fmtTime(op.endedAt) : op.missing.qty === 0 ? "completa" : op.etaAt ? `~${fmtTime(op.etaAt)}` : "—"}
                </strong>
                <span className="muted small">
                  {open && op.missing.qty > 0 && op.etaAt ? <Eta etaAt={op.etaAt} serverTime={d.serverTime} /> : open && op.missing.qty > 0 ? "aguardando bipagens" : " "}
                </span>
              </div>
              <div className="card ops-tile">
                <span className="section-label">Última bipagem</span>
                <strong className="ops-tile-main mono">{fmtClock(op.lastScanAt)}</strong>
                <span className="muted small">
                  {op.lastScanAt ? <SinceClock iso={op.lastScanAt} serverTime={d.serverTime} /> : " "}
                </span>
              </div>
              {d.functionTimeTodaySec !== null && (
                <div className="card ops-tile ops-tile-wide">
                  <span className="section-label">Tempo na função hoje</span>
                  <strong className="ops-tile-main mono">
                    {open ? <Elapsed since={new Date(d.serverTime).toISOString()} serverTime={d.serverTime} extraSec={d.functionTimeTodaySec} /> : fmtDuration(d.functionTimeTodaySec)}
                  </strong>
                </div>
              )}
            </section>
          </div>

          {d.scans.length > 0 && (
            <section className="card stack">
              <h2>Progresso da carga</h2>
              <ProgressChart scans={d.scans} total={op.total.qty} startedAt={op.startedAt} endAt={op.endedAt ? new Date(op.endedAt).getTime() : d.serverTime} />
            </section>
          )}

          <section className="card ops-detail-tabs">
            <UnderlineTabs
              label="Detalhes da carga"
              tabs={[
                {
                  value: "bipagens",
                  label: `Bipagens (${fmtQty(d.scans.length)})`,
                  content:
                    d.scans.length === 0 ? (
                      <span className="muted small">Nenhuma bipagem ainda.</span>
                    ) : (
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
                    ),
                },
                {
                  value: "codigos",
                  label: `Códigos (${fmtQty(d.codes?.length ?? 0)})`,
                  content: !d.codes?.length ? (
                    <span className="muted small">
                      Nenhum código registrado nesta carga. Para achar um código em qualquer carga, use a{" "}
                      <Link href="/operations/codigo">consulta por código de barras</Link>.
                    </span>
                  ) : (
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
                  ),
                },
                {
                  value: "hoje",
                  label: `Cargas de hoje (${d.today.length})`,
                  content:
                    d.today.length === 0 ? (
                      <span className="muted small">Nenhuma carga hoje.</span>
                    ) : (
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
                                  {o.fnLabel}
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
                    ),
                },
              ]}
            />
          </section>
        </>
      )}
    </div>
  );
}
