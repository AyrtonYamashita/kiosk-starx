"use client";

import { deleteProfile } from "@/lib/actions";

export function DeleteProfile({ id, name, devices }: { id: string; name: string; devices: number }) {
  return (
    <form
      action={deleteProfile}
      onSubmit={(e) => {
        const msg = devices
          ? `Excluir o perfil "${name}"?\n\nOs ${devices} aparelho(s) ficam sem perfil e continuam com a configuração que já têm.`
          : `Excluir o perfil "${name}"?`;
        if (!confirm(msg)) e.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={id} />
      <button className="danger">Excluir perfil</button>
    </form>
  );
}
