import Link from "next/link";
import { notFound } from "next/navigation";
import { api, type Me } from "@/lib/api";
import { SubjectRows, type Subject } from "./SubjectRows";

export const dynamic = "force-dynamic";

/**
 * Direitos dos titulares (LGPD, Art. 18). Os colaboradores não acessam o painel, então o administrador atende por eles,
 * a partir do canal de privacidade da empresa: confirma o que existe, exporta (cópia/portabilidade) e anonimiza.
 */
export default async function TitularesPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const me = await api<Me>("/v1/admin/me");
  if (me.role !== "admin") notFound();
  const { q = "" } = await searchParams;
  const { subjects } = await api<{ subjects: Subject[] }>(`/v1/admin/privacy/subjects?q=${encodeURIComponent(q)}`);

  return (
    <div className="stack wide fit-page">
      <div className="page-header">
        <h1>Privacidade</h1>
        <p>
          Pedidos dos colaboradores sobre os próprios dados (LGPD, Art. 18): confirmar o que existe, entregar uma cópia e anonimizar. A resposta completa
          deve sair em até 15 dias. Cada exportação e anonimização fica registrada na trilha de auditoria.
        </p>
      </div>

      <form className="card row" method="get" role="search" style={{ gap: 12, alignItems: "flex-end" }}>
        <label style={{ flex: "1 1 260px" }}>
          Usuário do SSW
          <input name="q" defaultValue={q} placeholder="começo do usuário, ex.: joao" maxLength={64} autoComplete="off" />
        </label>
        <div className="cargas-actions">
          <button className="primary">Buscar</button>
          {q && (
            <Link href="/titulares" className="link-button">
              limpar
            </Link>
          )}
        </div>
      </form>

      {/* a tabela fica sempre na tela: o estado da anonimização mora nela (o aviso não se perde quando a lista esvazia) */}
      <div className="card list-card">
        <div className="list-scroll">
          <table>
            <thead>
              <tr>
                <th>Colaborador (SSW)</th>
                <th style={{ textAlign: "right" }}>Cargas</th>
                <th style={{ textAlign: "right" }}>Bipagens</th>
                <th>Primeira</th>
                <th>Última</th>
                <th />
              </tr>
            </thead>
            <tbody>
              <SubjectRows subjects={subjects} empty={q ? "Nenhum colaborador com esse usuário." : "Nenhum colaborador identificado nas cargas."} />
            </tbody>
          </table>
        </div>
        <div className="list-foot">
          <span className="muted small">
            {subjects.length} {subjects.length === 1 ? "colaborador" : "colaboradores"}
            {subjects.length === 50 ? " (os 50 mais recentes; refine a busca)" : ""}
          </span>
        </div>
      </div>
    </div>
  );
}
