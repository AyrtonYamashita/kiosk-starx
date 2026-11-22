"use client";

import { useActionState } from "react";
import { anonymizeSubject } from "@/lib/actions";
import { dateTime } from "@/lib/format";
import { useConfirm } from "@/components/ConfirmDialog";
import { useActionToast } from "@/components/Toasts";

export type Subject = { user: string; operations: number; firstAt: string; lastAt: string; scans: number };

/**
 * Linhas da tela Privacidade. O estado da anonimização fica aqui (não em cada linha): a linha do colaborador
 * anonimizado some da lista na mesma atualização, e o aviso de resultado se perderia junto com ela.
 */
export function SubjectRows({ subjects, empty }: { subjects: Subject[]; empty: string }) {
  const ask = useConfirm();
  const [state, action, pending] = useActionState(anonymizeSubject, undefined);
  useActionToast(state);
  return (
    <>
      {state?.error && (
        <tr>
          <td colSpan={6}>
            <span className="alert error small">{state.error}</span>
          </td>
        </tr>
      )}
      {subjects.length === 0 && (
        <tr>
          <td colSpan={6} className="muted">
            {empty}
          </td>
        </tr>
      )}
      {subjects.map((s) => (
        <tr key={s.user}>
          <td className="mono">{s.user}</td>
          <td className="mono" style={{ textAlign: "right" }}>
            {s.operations}
          </td>
          <td className="mono" style={{ textAlign: "right" }}>
            {s.scans}
          </td>
          <td className="mono small">{dateTime(s.firstAt)}</td>
          <td className="mono small">{dateTime(s.lastAt)}</td>
          <td>
            <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
              <a href={`/titulares/export/${encodeURIComponent(s.user)}`} className="button" download>
                Exportar
              </a>
              <form
                action={action}
                onSubmit={(e) =>
                  ask.submit(e, {
                    title: `Anonimizar "${s.user}"?`,
                    message: `O usuário do SSW sai de ${s.operations} carga(s), do estado atual dos coletores e dos eventos guardados. As cargas e os números continuam, sem identificação. Não dá para desfazer: exporte antes se o colaborador pediu uma cópia.`,
                    confirmLabel: "Anonimizar",
                    danger: true,
                  })
                }
              >
                <input type="hidden" name="user" value={s.user} />
                <button className="danger" disabled={pending}>
                  Anonimizar
                </button>
              </form>
            </div>
          </td>
        </tr>
      ))}
    </>
  );
}
