"use client";

import { useActionState } from "react";
import { setOpsReaderAll } from "@/lib/actions";
import type { OpsSettings } from "@/lib/api";

/** Chave geral da leitura do SSW: só no piloto (ligados um a um) ou em todos os coletores. */
export function ReaderAll({ settings, canEdit }: { settings: OpsSettings; canEdit: boolean }) {
  const [state, action, pending] = useActionState(setOpsReaderAll, undefined);
  const { readerAll, devices } = settings;
  return (
    <section className="card stack">
      <h2>Leitura do SSW nos coletores</h2>
      <span className="muted small">
        {readerAll
          ? "Todos os coletores leem o SSW, menos os desligados um a um na página do coletor."
          : "Só os coletores ligados um a um (piloto) leem o SSW."}{" "}
        Lendo agora: {devices.reading} de {devices.total}
        {devices.custom > 0 && ` · ${devices.custom} com escolha própria`}. Coletores com app anterior ao 0.5.0 não leem.
      </span>
      <form action={action} className="row">
        <input type="hidden" name="all" value={readerAll ? "0" : "1"} />
        <span className={`badge ${readerAll ? "ok" : "off"}`}>
          <span className="dot" /> {readerAll ? "todos os coletores" : "só no piloto"}
        </span>
        {canEdit ? (
          <button
            disabled={pending}
            className={readerAll ? undefined : "primary"}
            onClick={(e) => {
              if (!readerAll && !confirm(`Ligar a leitura do SSW em todos os coletores (${devices.total - devices.custom} seguem a chave geral)?`))
                e.preventDefault();
            }}
          >
            {readerAll ? "Voltar para só o piloto" : "Ler em todos os coletores"}
          </button>
        ) : (
          <span className="muted small">só administradores mudam a chave geral</span>
        )}
        {state?.ok && <span className="alert ok">{state.ok}</span>}
        {state?.error && <span className="alert error">{state.error}</span>}
      </form>
    </section>
  );
}
