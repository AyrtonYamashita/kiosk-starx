import Link from "next/link";
import { FilterSheet } from "@/components/FilterSheet";
import { api, type OpsScanErrors } from "@/lib/api";
import { dateTime, dayTime } from "@/lib/format";

export const dynamic = "force-dynamic";

type Search = { type?: string; user?: string; device?: string; plate?: string; from?: string; to?: string; before?: string };

function qs(s: Search) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(s)) if (v) p.set(k, v);
  return p.toString();
}

/**
 * Erros de bipagem: cada código que o SSW recusou, com a mensagem exata que apareceu na tela do coletor. Filtra por
 * tipo de erro (a mesma mensagem, mesmo com números diferentes), colaborador, coletor, placa e período.
 */
export default async function ScanErrorsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const s = await searchParams;
  const filters = { type: s.type, user: s.user, device: s.device, plate: s.plate, from: s.from, to: s.to };
  const data = await api<OpsScanErrors>(`/v1/admin/ops/scan-errors?${qs({ ...filters, before: s.before })}`);
  const filtered = Object.values(filters).some(Boolean);
  const period = s.from || s.to ? "no período" : "nos últimos 7 dias";
  const total = data.types.reduce((n, t) => n + t.count, 0);
  // o tipo escolhido pode não estar no resumo (ex.: link antigo): continua na lista de escolha
  const types = s.type && !data.types.some((t) => t.type === s.type) ? [...data.types, { type: s.type, message: s.type, count: 0, lastAt: "" }] : data.types;

  const filterForm = (cls: string) => (
    <form className={cls} method="get" role="search">
      <label className="span-2">
        Tipo de erro
        <select name="type" defaultValue={s.type ?? ""}>
          <option value="">Todos</option>
          {types.map((t) =>
            t.type ? (
              <option key={t.type} value={t.type}>
                {t.message ?? t.type} ({t.count})
              </option>
            ) : null,
          )}
        </select>
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
        Coletor
        <select name="device" defaultValue={s.device ?? ""}>
          <option value="">Todos</option>
          {data.devices.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Placa
        <input name="plate" defaultValue={s.plate ?? ""} placeholder="ABC1D23" maxLength={20} autoComplete="off" />
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
          <Link href="/operations/erros" className="link-button">
            limpar
          </Link>
        )}
      </div>
    </form>
  );

  return (
    <div className="stack wide fit-page">
      <div className="row">
        <Link href="/operations" className="link-button" transitionTypes={["nav-back"]}>
          ← Acompanhamento
        </Link>
      </div>
      <div className="page-header">
        <h1 style={{ margin: 0 }}>Erros de bipagem</h1>
        <p>
          Códigos que o SSW recusou, com a mensagem exata que apareceu no coletor. Eles não entram nos volumes lidos da carga: quem não contou foi o próprio
          SSW.
        </p>
      </div>

      <div className="filters-desktop">{filterForm("card cargas-filters")}</div>

      {data.types.length > 0 && (
        <section className="card stack">
          <h2>
            {total} {total === 1 ? "erro" : "erros"} {period}
            {s.type ? " (todos os tipos)" : ""}
          </h2>
          <ul className="error-types">
            {data.types.map((t) => {
              const active = s.type === t.type;
              return (
                <li key={t.type ?? "?"}>
                  <Link href={`/operations/erros?${qs({ ...filters, type: active ? undefined : (t.type ?? undefined) })}`} className={active ? "active" : undefined}>
                    <span className="error-type-n mono">{t.count}</span>
                    <span className="error-type-msg">{t.message ?? "sem mensagem"}</span>
                    <span className="muted small">último {dayTime(t.lastAt)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {data.errors.length === 0 ? (
        <div className="card muted">{filtered ? "Nenhum erro com esses filtros." : "Nenhum erro de bipagem nos últimos 7 dias."}</div>
      ) : (
        <div className="card list-card">
          <div className="list-scroll">
            <table className="cargas-table">
              <thead>
                <tr>
                  <th>Quando</th>
                  <th>Mensagem do SSW</th>
                  <th>Código</th>
                  <th>Colaborador</th>
                  <th className="hide-sm">Carga</th>
                  <th className="hide-sm">Coletor</th>
                </tr>
              </thead>
              <tbody>
                {data.errors.map((e, i) => (
                  <tr key={`${e.at}-${i}`}>
                    <td className="mono">{dateTime(e.at)}</td>
                    <td>{e.message ?? <span className="muted">sem mensagem</span>}</td>
                    <td className="mono">
                      <Link href={`/operations/codigo?code=${encodeURIComponent(e.code)}`}>{e.code}</Link>
                    </td>
                    <td>{e.operation?.user ? <span className="mono">{e.operation.user}</span> : <span className="muted">—</span>}</td>
                    <td className="hide-sm">
                      {e.operation ? (
                        <Link href={`/operations/${e.device.id}?op=${e.operation.id}`}>
                          {e.operation.fnLabel} · <span className="mono">{e.operation.realPlate || e.operation.plate}</span>
                        </Link>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td className="hide-sm">
                      <Link href={`/devices/${e.device.id}`} className="mono small">
                        {e.device.name}
                      </Link>
                      {e.operation?.branch && <div className="muted small">{e.operation.branch}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* celular e tablet: um card por erro no lugar da tabela */}
          <ol className="cargas-cards" aria-label="Erros de bipagem">
            {data.errors.map((e, i) => (
              <li key={`${e.at}-${i}`} className="carga-card">
                <Link href={e.operation ? `/operations/${e.device.id}?op=${e.operation.id}` : `/devices/${e.device.id}`} className="carga-card-link">
                  <span className="mono">{e.code}</span>
                  <span className="carga-fn">{e.operation ? `${e.operation.fnLabel} · ${e.operation.realPlate || e.operation.plate}` : e.device.name}</span>
                </Link>
                <div className="bad small">{e.message ?? "sem mensagem"}</div>
                <div className="carga-meta muted small">
                  {dayTime(e.at)}
                  {e.operation?.user && ` · ${e.operation.user}`} · {e.device.name}
                </div>
              </li>
            ))}
          </ol>
          <div className="list-foot">
            <span className="muted small">
              {data.errors.length} {data.errors.length === 1 ? "erro" : "erros"}
              {data.next || s.before ? " nesta página" : ""}
            </span>
            <span className="spacer" />
            {s.before && (
              <Link href={`/operations/erros?${qs(filters)}`} className="link-button">
                voltar ao início
              </Link>
            )}
            {data.next && (
              <Link href={`/operations/erros?${qs({ ...filters, before: data.next })}`} className="button">
                Mais antigos
              </Link>
            )}
          </div>
        </div>
      )}

      <FilterSheet id="erros-filtros" count={Object.values(filters).filter(Boolean).length} closeOnSubmit>
        {filterForm("cargas-filters")}
      </FilterSheet>
    </div>
  );
}
