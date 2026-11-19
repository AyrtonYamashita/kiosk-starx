"use client";

import { useActionState, useRef } from "react";
import { setOpsReaderAll } from "@/lib/actions";
import type { OpsSettings } from "@/lib/api";

/** Chave geral da leitura do SSW, compacta no cabeçalho de Aparelhos: em todos os coletores ou só nos ligados um a um. */
export function ReaderAll({ settings, canEdit }: { settings: OpsSettings; canEdit: boolean }) {
  const [state, action, pending] = useActionState(setOpsReaderAll, undefined);
  const form = useRef<HTMLFormElement>(null);
  const { readerAll, devices } = settings;
  return (
    <form ref={form} action={action} className="reader-all">
      <input type="hidden" name="all" value={readerAll ? "0" : "1"} />
      <label
        className="check-label small"
        title={
          readerAll
            ? "Todos os coletores leem o SSW, menos os desligados um a um na página do coletor."
            : "Só os coletores ligados um a um leem o SSW."
        }
      >
        <input
          type="checkbox"
          checked={readerAll}
          disabled={!canEdit || pending}
          onChange={() => {
            if (!readerAll && !confirm(`Ligar a leitura do SSW em todos os coletores (${devices.total - devices.custom} seguem a chave geral)?`)) return;
            form.current?.requestSubmit();
          }}
        />
        Leitura do SSW em todos os coletores
      </label>
      <span className="muted small">
        lendo {devices.reading} de {devices.total}
      </span>
      {state?.error && <span className="alert error small">{state.error}</span>}
    </form>
  );
}
