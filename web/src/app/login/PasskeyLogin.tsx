"use client";

import { browserSupportsWebAuthn } from "@simplewebauthn/browser";
import { KeyRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { passkeyLoginFinish, passkeyLoginOptions } from "@/lib/actions";
import { getAssertion, passkeyError } from "@/lib/passkey-client";

/** "Entrar com passkey": sem usuário, senha nem código (a passkey já é o aparelho + biometria/PIN). */
export function PasskeyLogin() {
  const router = useRouter();
  const [supported, setSupported] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setSupported(browserSupportsWebAuthn()), []);
  if (!supported) return null;

  async function go() {
    setBusy(true);
    setError(null);
    try {
      const start = await passkeyLoginOptions();
      if (start.error || !start.options || !start.challengeId) throw new Error(start.error ?? "Não foi possível começar.");
      const response = await getAssertion(start.options);
      const done = await passkeyLoginFinish(start.challengeId, response);
      if (done.error) throw new Error(done.error);
      router.replace("/");
      router.refresh();
    } catch (e) {
      setError(passkeyError(e));
      setBusy(false);
    }
  }

  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="row muted small" style={{ gap: 10 }}>
        <span style={{ flex: 1, borderTop: "1px solid var(--rule)" }} />
        ou
        <span style={{ flex: 1, borderTop: "1px solid var(--rule)" }} />
      </div>
      <button type="button" onClick={go} disabled={busy} style={{ justifyContent: "center" }}>
        <KeyRound size={16} aria-hidden /> {busy ? "Aguardando a biometria…" : "Entrar com passkey"}
      </button>
      {error && <div className="alert error">{error}</div>}
    </div>
  );
}
