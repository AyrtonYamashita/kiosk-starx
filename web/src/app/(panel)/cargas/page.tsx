import Link from "next/link";
import { api, type OpsHistory } from "@/lib/api";
import { FilterSheet } from "@/components/FilterSheet";
import { dateTime } from "@/lib/format";
import { END_LABEL, fmtDuration, fmtMoney, fmtQty } from "@/lib/opsFormat";

export const dynamic = "force-dynamic";

type Search = { plate?: string; user?: string; fn?: string; status?: string; from?: string; to?: string; before?: string };

const STATUS: { value: string; label: string }[] = [
  { value: "open", label: "Em andamento" },
  { value: "concluded", label: "Concluída" },
  { value: "interrupted", label: "Interrompida" },
  { value: "left", label: "Saiu sem concluir" },
  { value: "replaced", label: "Trocou de placa" },
  { value: "signal_lost", label: "Perdeu o sinal" },
];

function qs(s: Search) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(s)) if (v) p.set(k, v);
  return p.toString();
}

function Status({ o }: { o: OpsHistory["operations"][number] }) {
  if (!o.endedAt)
    return (
      <span className="badge blue">
        <span className="dot" /> em andamento
      </span>
    );
  const tone = o.endReason === "concluded" ? "ok" : o.endReason === "signal_lost" || o.endReason === "left" ? "warn" : "off";
  return (
    <span className={`badge ${tone}`}>
      <span className="dot" /> {END_LABEL[o.endReason ?? ""] ?? "encerrada"}
    </span>
  );
}

/** Histórico de todas as cargas: placa, função, colaborador, coletor, volumes, duração e situação. */
export default async function CargasPage({ searchParams }: { searchParams: Promise<Search> }) {
  const s = await searchParams;
  const filters = { plate: s.plate, user: s.user, fn: s.fn, status: s.status, from: s.from, to: s.to };
  const data = await api<OpsHistory>(`/v1/admin/ops/operations?${qs({ ...filters, before: s.before })}`);
  const filtered = Object.values(filters).some(Boolean);

  // o mesmo formulário (GET) no card do desktop e na folha de filtros do celular
  const filterForm = (cls: string) => (
        <form className={cls} method="get" role="search">
          <label>
            Placa
            <input name="plate" defaultValue={s.plate ?? ""} placeholder="ABC1D23" maxLength={20} autoComplete="off" />
          </label>
          <label>
            Colaborador
            <select name="user" defaultValue={s.user ?? ""}>
              <option value="">Todos</option>
              {data.users.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </label>
          <label>
            Função
            <select name="fn" defaultValue={s.fn ?? ""}>
              <option value="">Todas</option>
              {data.functions.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Situação
            <select name="status" defaultValue={s.status ?? ""}>
              <option value="">Todas</option>
              {STATUS.map((x) => (
                <option key={x.value} value={x.value}>
                  {x.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            De
            <input type="date" name="from" defaultValue={s.from ?? ""} />
          </label>
          <label>
            Até
            <input type="date" name="to" defaultValue={s.to ?? ""} />
          </label>
          <div className="cargas-actions">
            <button className="primary">Filtrar</button>
            {filtered && (
              <Link href="/cargas" className="link-button">
                limpar
              </Link>
            )}
          </div>
        </form>
  );

  return (
    <div className="stack wide fit-page">
      <div className="row">
        <h1 style={{ margin: 0 }}>Cargas</h1>
      </div>

      <div className="filters-desktop">{filterForm("card cargas-filters")}</div>

      {data.operations.length === 0 ? (
        <div className="card muted">{filtered ? "Nenhuma carga com esses filtros." : "Nenhuma carga registrada ainda."}</div>
      ) : (
        <div className="card list-card">
          <div className="list-scroll">
            <table className="cargas-table">
              <thead>
                <tr>
                  <th>Início</th>
                  <th>Placa</th>
                  <th className="hide-sm">Função</th>
                  <th>Colaborador</th>
                  <th className="hide-sm">Coletor</th>
                  <th style={{ textAlign: "right" }}>Volumes</th>
                  <th className="hide-sm" style={{ textAlign: "right" }}>
                    Valor
                  </th>
                  <th className="hide-sm" style={{ textAlign: "right" }}>
                    Duração
                  </th>
                  <th>Situação</th>
                </tr>
              </thead>
              <tbody>
                {data.operations.map((o) => {
                  const pct = o.totalQty > 0 ? Math.min(100, (o.readQty / o.totalQty) * 100) : 0;
                  return (
                    <tr key={o.id}>
                      <td className="mono">
                        <Link href={`/operations/${o.device.id}?op=${o.id}`} className="cargas-link">
                          {dateTime(o.startedAt)}
                        </Link>
                      </td>
                      <td>
                        <span className="ops-plate mono">{o.realPlate || o.plate}</span>
                        {o.realPlate && o.realPlate !== o.plate && <div className="muted small mono">{o.plate}</div>}
                      </td>
                      <td className="hide-sm">
                        {o.fnLabel}
                        {o.units.length > 0 && <div className="muted small">{o.units.join(" · ")}</div>}
                      </td>
                      <td>{o.user ? <span className="mono">{o.user}</span> : <span className="muted">—</span>}</td>
                      <td className="hide-sm">
                        <Link href={`/devices/${o.device.id}`} className="mono small">
                          {o.device.name}
                        </Link>
                        {o.branch && <div className="muted small">{o.branch}</div>}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <span className="mono">
                          {fmtQty(o.readQty)}/{fmtQty(o.totalQty)}
                        </span>
                        <div className="ops-bar cargas-bar" aria-hidden>
                          <span style={{ width: `${pct}%` }} />
                        </div>
                      </td>
                      <td className="hide-sm mono" style={{ textAlign: "right" }}>
                        {fmtMoney(o.totalValue)}
                      </td>
                      <td className="hide-sm mono" style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        {fmtDuration(o.durationSec)}
                      </td>
                      <td>
                        <Status o={o} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {/* celular e tablet (abaixo de 1024 px): um card por carga no lugar da tabela, sem rolagem lateral */}
          <ol className="cargas-cards" aria-label="Cargas">
            {data.operations.map((o) => {
              const pct = o.totalQty > 0 ? Math.min(100, (o.readQty / o.totalQty) * 100) : 0;
              return (
                <li key={o.id} className="carga-card">
                  <div className="carga-card-head">
                    <Link href={`/operations/${o.device.id}?op=${o.id}`} className="carga-card-title">
                      <span className="ops-plate mono">{o.realPlate || o.plate}</span>
                      <span>{o.fnLabel}</span>
                    </Link>
                    <Status o={o} />
                  </div>
                  <div className="muted small">
                    <span className="mono">{dateTime(o.startedAt)}</span>
                    {o.realPlate && o.realPlate !== o.plate && <span className="mono"> · placa no SSW {o.plate}</span>}
                    {o.units.length > 0 && <span> · {o.units.join(" · ")}</span>}
                  </div>
                  <div className="carga-card-qty">
                    <span className="mono">
                      {fmtQty(o.readQty)}/{fmtQty(o.totalQty)}
                    </span>
                    <span className="muted small">volumes</span>
                    <div className="ops-bar" aria-hidden>
                      <span style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                  <dl className="ops-facts">
                    <div>
                      <dt>Colaborador</dt>
                      <dd>{o.user ? <span className="mono">{o.user}</span> : <span className="muted">—</span>}</dd>
                    </div>
                    <div>
                      <dt>Coletor</dt>
                      <dd>
                        <Link href={`/devices/${o.device.id}`} className="mono">
                          {o.device.name}
                        </Link>
                        {o.branch && <div className="muted small">{o.branch}</div>}
                      </dd>
                    </div>
                    <div>
                      <dt>Valor</dt>
                      <dd className="mono">{fmtMoney(o.totalValue)}</dd>
                    </div>
                    <div>
                      <dt>Duração</dt>
                      <dd className="mono">{fmtDuration(o.durationSec)}</dd>
                    </div>
                  </dl>
                </li>
              );
            })}
          </ol>
          <div className="list-foot">
            <span className="muted small">
              {data.operations.length} {data.operations.length === 1 ? "carga" : "cargas"}
              {data.next || s.before ? " nesta página" : ""}
            </span>
            <span className="spacer" />
            {s.before && (
              <Link href={`/cargas?${qs(filters)}`} className="link-button">
                voltar ao início
              </Link>
            )}
            {data.next && (
              <Link href={`/cargas?${qs({ ...filters, before: data.next })}`} className="button">
                Mais antigas
              </Link>
            )}
          </div>
        </div>
      )}

      {/* celular: barra "Filtros" no pé da tela (a lista fica em cima); o toque abre a folha com o formulário */}
      <FilterSheet id="cargas-filtros" count={Object.values(filters).filter(Boolean).length} closeOnSubmit>
        {filterForm("cargas-filters")}
      </FilterSheet>
    </div>
  );
}
