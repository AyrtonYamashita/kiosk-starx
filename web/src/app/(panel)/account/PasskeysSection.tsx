"use client";

import { browserSupportsWebAuthn } from "@simplewebauthn/browser";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { registerPasskeyFinish, registerPasskeyOptions, removePasskey } from "@/lib/actions";
import type { MfaInfo } from "@/lib/api";
import { createCredential, passkeyError, suggestedName } from "@/lib/passkey-client";

const fmt = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });

/** Passkeys na Conta: lista, adicionar (senha atual + biometria) e remover. */
export function PasskeysSection({ passkeys }: { passkeys: MfaInfo["passkeys"] }) {
  const router = useRouter();
  const [supported, setSupported] = useState(true);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  useEffect(() => {
    setSupported(browserSupportsWebAuthn());
    setName(suggestedName());
  }, []);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const start = await registerPasskeyOptions(password);
      if (start.error || !start.options || !start.challengeId) throw new Error(start.error ?? "Não foi possível começar.");
      const response = await createCredential(start.options);
      const done = await registerPasskeyFinish(start.challengeId, response, name.trim() || "Passkey");
      if (done.error) throw new Error(done.error);
      setOk("Passkey cadastrada. Na tela de login use “Entrar com passkey”.");
      setOpen(false);
      setPassword("");
      router.refresh();
    } catch (err) {
      setError(passkeyError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <span className="muted small">
        Entre só com a digital, o rosto ou o PIN deste aparelho (Windows Hello, celular, chave de segurança), sem senha nem código.
      </span>
      {passkeys.length > 0 && (
        <div className="table-wrap">
          <table>
            <tbody>
              {passkeys.map((p) => (
                <tr key={p.id}>
                  <td>
                    {p.name} {p.synced && <span className="badge off">sincronizada</span>}
                    <div className="muted small">desde {fmt(p.createdAt)}</div>
                  </td>
                  <td className="small">{p.lastUsedAt ? `usada em ${fmt(p.lastUsedAt)}` : <span className="muted">ainda não usada</span>}</td>
                  <td style={{ textAlign: "right" }}>
                    <form
                      action={removePasskey}
                      onSubmit={(e) => {
                        if (!confirm(`Remover a passkey "${p.name}"? Ela deixa de entrar no painel.`)) e.preventDefault();
                      }}
                    >
                      <input type="hidden" name="id" value={p.id} />
                      <button className="danger">Remover</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {ok && <div className="alert ok">{ok}</div>}
      {!supported ? (
        <span className="muted small">Este navegador não suporta passkeys.</span>
      ) : open ? (
        <form onSubmit={add} className="stack">
          <label>
            Nome (para reconhecer depois)
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required />
          </label>
          <label>
            Senha atual
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          </label>
          {error && <div className="alert error">{error}</div>}
          <div className="row">
            <button className="primary" disabled={busy}>
              {busy ? "Aguardando a biometria…" : "Continuar"}
            </button>
            <button type="button" className="link-button" onClick={() => setOpen(false)}>
              cancelar
            </button>
          </div>
        </form>
      ) : (
        <div>
          <button type="button" onClick={() => setOpen(true)}>
            Adicionar passkey
          </button>
        </div>
      )}
    </div>
  );
}
