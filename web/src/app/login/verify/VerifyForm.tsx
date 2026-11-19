"use client";

import { browserSupportsWebAuthn } from "@simplewebauthn/browser";
import { AnimateIcon } from "@animate-ui/react/icons";
import { KeyRound } from "@/components/animate-ui/icons/key-round";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { cancelMfa, mfaPasskeyFinish, mfaPasskeyOptions, resendMfaCode, verifyMfa } from "@/lib/actions";
import { getAssertion, passkeyError } from "@/lib/passkey-client";
import { useClientValue } from "@/lib/client";

type Method = "passkey" | "totp" | "email" | "recovery";
type CodeMethod = Exclude<Method, "passkey">;

/** E-mail e recuperação: ABCD-2345 (maiúsculas, hífen no meio). App: 6 dígitos. */
function formatInput(method: CodeMethod, raw: string): string {
  if (method === "totp") return raw.replace(/\D/g, "").slice(0, 6);
  const s = raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  return s.length > 4 ? `${s.slice(0, 4)}-${s.slice(4)}` : s;
}

const LABEL: Record<CodeMethod, string> = {
  totp: "Código do app autenticador",
  email: "Código do e-mail",
  recovery: "Código de recuperação",
};

export function VerifyForm({
  methods,
  emailHint,
  codeSent,
  trustDays,
  initialWaitSec,
}: {
  methods: Method[];
  emailHint: string | null;
  codeSent: boolean;
  trustDays: number;
  initialWaitSec: number;
}) {
  const router = useRouter();
  const [chosen, setMethod] = useState<Method | null>(null);
  const [code, setCode] = useState("");
  const [trust, setTrust] = useState(false);
  const [state, action, pending] = useActionState(verifyMfa, undefined);
  const [wait, setWait] = useState(initialWaitSec);
  // pediu o código por e-mail: passa a digitar o do e-mail
  const [resendState, resend, resending] = useActionState(async (prev: Awaited<ReturnType<typeof resendMfaCode>>) => {
    const r = await resendMfaCode(prev);
    if (r?.retryAfterSec) setWait(r.retryAfterSec);
    if (r?.ok) {
      setMethod("email");
      setCode("");
    }
    return r;
  }, undefined);
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [passkeyErr, setPasskeyErr] = useState<string | null>(null);
  const canPasskey = useClientValue(browserSupportsWebAuthn, true);
  // navegador sem passkey: começa pelo próximo método
  const method: Method = chosen ?? (methods[0] === "passkey" && !canPasskey ? (methods[1] ?? "recovery") : (methods[0] ?? "recovery"));
  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const ready = method === "totp" ? code.length === 6 : code.replace("-", "").length === 8;
  const switchTo = (m: Method) => {
    setMethod(m);
    setCode("");
    setPasskeyErr(null);
  };

  async function usePasskey() {
    setPasskeyBusy(true);
    setPasskeyErr(null);
    try {
      const start = await mfaPasskeyOptions();
      if (start.error || !start.options || !start.challengeId) throw new Error(start.error ?? "Não foi possível começar.");
      const response = await getAssertion(start.options);
      const done = await mfaPasskeyFinish(start.challengeId, response, trust);
      if (done.error) throw new Error(done.error);
      router.replace("/");
      router.refresh();
    } catch (e) {
      setPasskeyErr(passkeyError(e));
      setPasskeyBusy(false);
    }
  }

  const hint =
    method === "passkey"
      ? "Confirme com a passkey deste aparelho (digital, rosto ou PIN)."
      : method === "totp"
        ? "Digite o código de 6 dígitos do seu app autenticador."
        : method === "recovery"
          ? "Digite um dos seus códigos de recuperação (cada um vale uma vez)."
          : !emailHint
            ? "Sua conta não tem e-mail cadastrado: use um código de recuperação ou peça ao administrador."
            : codeSent || resendState?.ok
              ? `Enviamos um código de 8 caracteres para ${emailHint}. Ele vale por 10 minutos.`
              : `Um código já foi enviado para ${emailHint} há pouco. Use-o ou peça outro.`;

  const trustBox = (
    <label className="inline">
      <input type="checkbox" name="trust" checked={trust} onChange={(e) => setTrust(e.target.checked)} />
      Confiar neste navegador por {trustDays} dias (não pedir o código aqui)
    </label>
  );

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div>
        <h1>Confirme o acesso</h1>
        <p className="muted" style={{ margin: 0, fontSize: 12 }}>
          {hint}
        </p>
      </div>

      {method === "passkey" ? (
        <div className="stack">
          {trustBox}
          {passkeyErr && <div className="alert error">{passkeyErr}</div>}
          <AnimateIcon animateOnHover animateOnTap asChild>
            <button type="button" className="primary" onClick={usePasskey} disabled={passkeyBusy} style={{ justifyContent: "center" }}>
              <KeyRound size={20} strokeWidth={1.75} aria-hidden /> {passkeyBusy ? "Aguardando a biometria…" : "Usar passkey"}
            </button>
          </AnimateIcon>
        </div>
      ) : (
        <form action={action} className="stack">
          <input type="hidden" name="method" value={method} />
          <label>
            {LABEL[method]}
            <input
              key={method}
              name="code"
              value={code}
              onChange={(e) => setCode(formatInput(method, e.target.value))}
              autoFocus
              autoComplete="one-time-code"
              inputMode={method === "totp" ? "numeric" : "text"}
              className="mono"
              placeholder={method === "totp" ? "123456" : "ABCD-2345"}
              style={{ fontSize: 20, letterSpacing: "0.15em", textAlign: "center", height: 44 }}
              required
            />
          </label>
          {trustBox}
          {state?.error && (
            <div className="alert error">
              {state.error}
              {state.attemptsLeft !== undefined ? ` (${state.attemptsLeft} tentativa(s) restante(s))` : ""}
            </div>
          )}
          <button className="primary" disabled={pending || !ready}>
            {pending ? "Conferindo…" : "Entrar"}
          </button>
        </form>
      )}

      <div className="stack" style={{ gap: 6, alignItems: "flex-start" }}>
        {method !== "passkey" && methods.includes("passkey") && canPasskey && (
          <button type="button" className="link-button" onClick={() => switchTo("passkey")}>
            Usar passkey
          </button>
        )}
        {method !== "totp" && methods.includes("totp") && (
          <button type="button" className="link-button" onClick={() => switchTo("totp")}>
            Usar o app autenticador
          </button>
        )}
        {methods.includes("email") && (
          <form action={resend}>
            <button className="link-button" disabled={resending || wait > 0}>
              {wait > 0
                ? `${method === "email" ? "Reenviar código" : "Receber código por e-mail"} em ${wait} s`
                : resending
                  ? "Enviando…"
                  : method === "email"
                    ? "Reenviar código"
                    : method === "totp"
                      ? "Sem o celular? Receber código por e-mail"
                      : "Receber código por e-mail"}
            </button>
          </form>
        )}
        {method === "recovery" && methods.includes("email") && !methods.includes("totp") && !methods.includes("passkey") && (
          <button type="button" className="link-button" onClick={() => switchTo("email")}>
            Usar o código do e-mail
          </button>
        )}
        {method !== "recovery" && methods.includes("recovery") && (
          <button type="button" className="link-button" onClick={() => switchTo("recovery")}>
            Usar código de recuperação
          </button>
        )}
      </div>
      {resendState?.ok && <div className="alert ok small">{resendState.ok}</div>}
      {resendState?.error && <div className="alert warn small">{resendState.error}</div>}
      <form action={cancelMfa}>
        <button className="link-button">Voltar e entrar com outra conta</button>
      </form>
    </div>
  );
}
