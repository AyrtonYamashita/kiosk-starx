import Link from "next/link";
import { ApiError, api, type OpsCodeHit } from "@/lib/api";
import { dateTime } from "@/lib/format";
import { CODE_KIND, END_LABEL, fmtQty } from "@/lib/opsFormat";

export const dynamic = "force-dynamic";

/** Consulta por código de barras: em que carga, coletor, colaborador e hora foi bipado (últimos 12 meses). */
export default async function CodeSearchPage({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const code = ((await searchParams).code ?? "").trim();
  let results: OpsCodeHit[] | null = null;
  let error: string | null = null;
  if (code) {
    try {
      results = (await api<{ results: OpsCodeHit[] }>(`/v1/admin/ops/scans?code=${encodeURIComponent(code)}`)).results;
    } catch (e) {
      error = e instanceof ApiError ? e.message : "Não foi possível consultar agora.";
    }
  }

  return (
    <div className="stack wide">
      <div className="row">
        <Link href="/operations" className="link-button" transitionTypes={["nav-back"]}>
          ← Acompanhamento
        </Link>
      </div>
      <h1 style={{ margin: 0 }}>Consulta por código de barras</h1>

      <section className="card stack">
        <form method="get" className="row">
          <label style={{ flex: 1, minWidth: 240 }}>
            Código (inteiro ou o começo, mínimo 3 caracteres)
            <input name="code" defaultValue={code} minLength={3} maxLength={80} required autoFocus className="mono" inputMode="numeric" />
          </label>
          <button className="primary" style={{ alignSelf: "flex-end" }}>
            Consultar
          </button>
        </form>
        <span className="muted small">
          Códigos lidos nos coletores com app 0.5.2 ou mais novo, guardados por 1 ano. Mostra até 100 resultados, os exatos primeiro.
        </span>
      </section>

      {error && <div className="alert error">{error}</div>}

      {results && (
        <section className="card stack">
          <h2>
            {results.length === 0 ? "Nenhuma bipagem com esse código" : `${results.length === 100 ? "100+" : results.length} bipagem(ns)`}
          </h2>
          {results.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Quando</th>
                    <th>Código</th>
                    <th>Tipo</th>
                    <th>Carga</th>
                    <th>Colaborador</th>
                    <th>Coletor</th>
                    <th style={{ textAlign: "right" }}>Lidos</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r, i) => {
                    const [cls, label] = CODE_KIND[r.kind] ?? ["off", r.kind];
                    const o = r.operation;
                    return (
                      <tr key={`${r.at}-${i}`}>
                        <td>{dateTime(r.at)}</td>
                        <td className="mono">{r.code}</td>
                        <td>
                          <span className={`badge ${cls}`}>{label}</span>
                        </td>
                        <td>
                          {o ? (
                            <Link href={`/operations/${r.device.id}?op=${o.id}`}>
                              {o.fnLabel} · <span className="mono">{o.plate}</span>
                            </Link>
                          ) : (
                            <span className="muted">—</span>
                          )}
                          {o && <div className="muted small">{o.endedAt ? (END_LABEL[o.endReason ?? ""] ?? o.endReason) : "em andamento"}</div>}
                        </td>
                        <td>
                          {o?.user ?? <span className="muted">—</span>}
                          {o?.branch && <span className="muted small"> · {o.branch}</span>}
                        </td>
                        <td>
                          <Link href={`/devices/${r.device.id}`}>{r.device.name}</Link>
                        </td>
                        <td className="mono" style={{ textAlign: "right" }}>
                          {r.readQty === null ? "—" : fmtQty(r.readQty)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
