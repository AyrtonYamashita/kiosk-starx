"use client";

import { useActionToast } from "@/components/Toasts";
import { useActionState, useRef, useState } from "react";
import { PencilLine } from "lucide-react";
import Link from "next/link";
import { deleteDevice, renameDevice, setPilot } from "@/lib/actions";
import { useConfirm } from "@/components/ConfirmDialog";

/**
 * Nome do coletor no topo da página: clique para editar. Enter ou clicar fora salva, Esc desiste. Em branco, volta ao
 * nome padrão gerado no cadastro. É o nome usado no painel todo (lista, avisos, acompanhamento).
 */
export function EditableName({ id, name, fallback }: { id: string; name: string; fallback: string }) {
  const [state, action, pending] = useActionState(renameDevice, undefined);
  useActionToast(state);
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
 * Coletor piloto: recebe antes dos outros as versões novas do app do kiosk e do leitor do SSW que forem publicadas
 * "para os pilotos" (página Apps). Os demais continuam na versão de todos até ela ser publicada para todos.
 */
export function PilotToggle({ id, pilot }: { id: string; pilot: boolean }) {
  const ask = useConfirm();
  const [state, action, pending] = useActionState(setPilot, undefined);
  useActionToast(state);
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row">
        <strong className="small">Piloto</strong>
        <span className={`badge ${pilot ? "blue" : "off"}`}>
          <span className="dot" /> {pilot ? "piloto" : "segue a versão de todos"}
        </span>
        <span className="spacer" />
        <form
          action={action}
          onSubmit={(e) =>
            ask.submit(e, {
              title: pilot ? "Tirar este coletor dos pilotos?" : "Marcar este coletor como piloto?",
              message: pilot
                ? "Ele volta para a versão de todos no próximo contato (se estava numa versão de teste do app, fica nela até a de todos passar à frente: o Android não rebaixa)."
                : "Ele passa a receber as versões publicadas para os pilotos (app do kiosk e leitor do SSW) antes dos outros coletores.",
              confirmLabel: pilot ? "Tirar dos pilotos" : "Marcar como piloto",
            })
          }
        >
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="pilot" value={pilot ? "0" : "1"} />
          <button disabled={pending} className={pilot ? undefined : "primary"}>
            {pilot ? "Tirar dos pilotos" : "Marcar como piloto"}
          </button>
        </form>
      </div>
      <span className="muted small">
        Piloto recebe primeiro as versões novas publicadas para os pilotos em <Link href="/apps">Apps</Link>; os outros só quando a versão for publicada para todos.
      </span>
      {state?.error && <span className="alert error">{state.error}</span>}
    </div>
  );
}

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
