"use client";

import { useActionState, useRef, useState } from "react";
import { PencilLine } from "lucide-react";
import { deleteDevice, renameDevice, setOpsReader } from "@/lib/actions";
import { useConfirm } from "@/components/ConfirmDialog";

/**
 * Nome do coletor no topo da página: clique para editar. Enter ou clicar fora salva, Esc desiste. Em branco, volta ao
 * nome padrão gerado no cadastro. É o nome usado no painel todo (lista, avisos, acompanhamento).
 */
export function EditableName({ id, name, fallback }: { id: string; name: string; fallback: string }) {
  const [state, action, pending] = useActionState(renameDevice, undefined);
  const [editing, setEditing] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const cancelled = useRef(false);
  // enquanto salva, já mostra o nome novo (o da página só chega depois do refresh)
  const [saving, setSaving] = useState(name);

  if (!editing)
    return (
      <div className="device-name-wrap">
        <h1 className="device-name">
          <button type="button" className="device-name-btn" title="Clique para renomear" onClick={() => setEditing(true)}>
            {pending ? saving : name}
            <PencilLine size={13} className="device-name-pen" aria-hidden />
          </button>
        </h1>
        {pending && <span className="muted small">salvando…</span>}
        {state?.error && <span className="alert error small">{state.error}</span>}
      </div>
    );

  const finish = () => {
    setEditing(false);
    const input = formRef.current?.elements.namedItem("name") as HTMLInputElement | null;
    if (cancelled.current || !input) return;
    const next = input.value.trim();
    // sem mudança: não manda nada
    if ((next || fallback) === name) return;
    setSaving(next || fallback);
    formRef.current?.requestSubmit();
  };

  return (
    <form
      ref={formRef}
      action={action}
      className="device-name-form"
      onSubmit={() => {
        cancelled.current = false;
      }}
    >
      <input type="hidden" name="id" value={id} />
      <input
        name="name"
        className="device-name-input"
        defaultValue={name === fallback ? "" : name}
        placeholder={fallback}
        maxLength={80}
        aria-label="Nome do coletor"
        autoFocus
        onFocus={(e) => {
          cancelled.current = false;
          e.currentTarget.select();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          } else if (e.key === "Escape") {
            cancelled.current = true;
            e.currentTarget.blur();
          }
        }}
        onBlur={finish}
      />
      <span className="muted small">Enter salva · Esc cancela · em branco fica {fallback}</span>
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
  const ask = useConfirm();
  return (
    <form
      action={deleteDevice}
      onSubmit={(e) =>
        ask.submit(e, {
          title: `Remover "${name}" do painel?`,
          message: "O aparelho continua com o kiosk, mas para de aparecer aqui até ser cadastrado de novo.",
          confirmLabel: "Remover",
          danger: true,
        })
      }
      className="row"
    >
      <input type="hidden" name="id" value={id} />
      <button className="danger">Remover do painel</button>
      <span className="muted small">O kiosk do aparelho não é afetado.</span>
    </form>
  );
}
