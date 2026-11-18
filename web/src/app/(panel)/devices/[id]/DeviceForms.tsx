"use client";

import { useActionState } from "react";
import { deleteDevice, renameDevice, setOpsReader } from "@/lib/actions";

export function RenameDevice({ id, name }: { id: string; name: string }) {
  const [state, action, pending] = useActionState(renameDevice, undefined);
  return (
    <form action={action} className="row">
      <input type="hidden" name="id" value={id} />
      <label style={{ flex: 1, minWidth: 220 }}>
        Nome
        <input name="name" defaultValue={name} maxLength={80} required />
      </label>
      <button disabled={pending} style={{ alignSelf: "flex-end" }}>
        Salvar nome
      </button>
      {state?.ok && <span className="alert ok">{state.ok}</span>}
      {state?.error && <span className="alert error">{state.error}</span>}
    </form>
  );
}

/**
 * Leitura do SSW neste coletor: o que vale agora, de onde vem (chave geral ou escolha no coletor) e os botões para
 * ligar/desligar só neste coletor ou voltar a seguir a chave geral.
 */
export function OpsReaderToggle({
  id,
  on,
  choice,
  all,
  appVersionCode,
}: {
  id: string;
  on: boolean;
  choice: boolean | null;
  all: boolean;
  appVersionCode: number | null;
}) {
  const [state, action, pending] = useActionState(setOpsReader, undefined);
  const oldApp = appVersionCode !== null && appVersionCode < OPS_MIN_VERSION_CODE;
  const source = choice === null ? `pela chave geral (${all ? "todos os coletores" : "só no piloto"})` : "escolhido neste coletor";
  return (
    <div className="row">
      <span className={`badge ${on ? "ok" : "off"}`}>
        <span className="dot" /> {on ? "ligada" : "desligada"}
      </span>
      <span className="muted small">{source}</span>
      <form action={action}>
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="on" value={on ? "0" : "1"} />
        <button disabled={pending} className={on ? undefined : "primary"}>
          {on ? "Desligar neste coletor" : "Ligar neste coletor"}
        </button>
      </form>
      {choice !== null && (
        <form action={action}>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="on" value="default" />
          <button disabled={pending}>Seguir a chave geral ({all ? "ligada" : "desligada"})</button>
        </form>
      )}
      {on && oldApp && <span className="badge warn">precisa do app 0.5.0 ou mais novo</span>}
      {state?.ok && <span className="alert ok">{state.ok}</span>}
      {state?.error && <span className="alert error">{state.error}</span>}
    </div>
  );
}

/** Primeira versão do app com o leitor do SSW (0.5.0). */
const OPS_MIN_VERSION_CODE = 10;

export function DeleteDevice({ id, name }: { id: string; name: string }) {
  return (
    <form
      action={deleteDevice}
      onSubmit={(e) => {
        if (!confirm(`Remover "${name}" do painel?\n\nO aparelho continua com o kiosk, mas para de aparecer aqui até ser cadastrado de novo.`)) e.preventDefault();
      }}
      className="row"
    >
      <input type="hidden" name="id" value={id} />
      <button className="danger">Remover do painel</button>
      <span className="muted small">O kiosk do aparelho não é afetado.</span>
    </form>
  );
}
