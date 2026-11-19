"use client";

import { browserSupportsWebAuthn } from "@simplewebauthn/browser";
import { AnimateIcon } from "@animate-ui/react/icons";
import { KeyRound } from "@/components/animate-ui/icons/key-round";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { passkeyLoginFinish, passkeyLoginOptions } from "@/lib/actions";
import { getAssertion, passkeyError } from "@/lib/passkey-client";
import { useClientValue } from "@/lib/client";

/** "Entrar com passkey": sem usuário, senha nem código (a passkey já é o aparelho + biometria/PIN). */
export function PasskeyLogin() {
  const router = useRouter();
  const supported = useClientValue(browserSupportsWebAuthn, false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      <AnimateIcon animateOnHover animateOnTap asChild>
        <button type="button" onClick={go} disabled={busy} style={{ justifyContent: "center" }}>
          <KeyRound size={20} strokeWidth={1.75} aria-hidden /> {busy ? "Aguardando a biometria…" : "Entrar com passkey"}
        </button>
      </AnimateIcon>
      {error && <div className="alert error">{error}</div>}
    </div>
  );
}
