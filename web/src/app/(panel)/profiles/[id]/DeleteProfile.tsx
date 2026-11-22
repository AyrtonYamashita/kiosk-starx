"use client";

import { deleteProfile } from "@/lib/actions";
import { useConfirm } from "@/components/ConfirmDialog";

export function DeleteProfile({ id, name, devices }: { id: string; name: string; devices: number }) {
  const ask = useConfirm();
  return (
    <form
      action={deleteProfile}
      onSubmit={(e) =>
        ask.submit(e, {
          title: `Excluir o perfil "${name}"?`,
          message: devices ? `Os ${devices} aparelho(s) ficam sem perfil e continuam com a configuração que já têm.` : undefined,
          confirmLabel: "Excluir",
          danger: true,
        })
      }
    >
      <input type="hidden" name="id" value={id} />
      <button className="danger">Excluir perfil</button>
    </form>
  );
}
