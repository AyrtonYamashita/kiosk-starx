"use client";

import { useActionState } from "react";
import { setOpsReaderAll } from "@/lib/actions";
import type { OpsSettings } from "@/lib/api";

/** Chave geral da leitura do SSW: todos os coletores ou só os pilotos (ligados um a um). */
export function ReaderAll({ settings, canEdit }: { settings: OpsSettings; canEdit: boolean }) {
  const [state, action, pending] = useActionState(setOpsReaderAll, undefined);
  const { readerAll, devices } = settings;
  return (
    <form
      action={action}
      className="reader-all"
      title={`Leitura do SSW: lendo em ${devices.reading} de ${devices.total} coletores`}
      onSubmit={(e) => {
        const to = ((e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null)?.value;
        if (to === "1" && !confirm(`Ligar a leitura do SSW em todos os coletores (${devices.total - devices.custom} seguem a chave geral)?`)) e.preventDefault();
      }}
    >
      <span className="small muted">Leitura do SSW</span>
      <div className="segmented" role="group" aria-label="Leitura do SSW">
        <button name="all" value="1" aria-pressed={readerAll} disabled={!canEdit || pending || readerAll} className={readerAll ? "on" : undefined}>
          Todos
        </button>
        <button name="all" value="0" aria-pressed={!readerAll} disabled={!canEdit || pending || !readerAll} className={readerAll ? undefined : "on"}>
          Pilotos
        </button>
      </div>
      {state?.error && <span className="alert error small">{state.error}</span>}
    </form>
  );
}
