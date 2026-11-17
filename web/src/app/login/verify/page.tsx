import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { MFA_COOKIE, MFA_INFO_COOKIE } from "@/lib/api";
import { VerifyForm } from "./VerifyForm";

export const dynamic = "force-dynamic";

type Info = { methods: ("email" | "recovery")[]; emailHint: string | null; codeSent: boolean; retryAfterSec: number; trustDays: number; at: number };

/** Etapa 2 do login: o código enviado por e-mail (ou um código de recuperação). */
export default async function VerifyPage() {
  const jar = await cookies();
  if (!jar.get(MFA_COOKIE)) redirect("/login");
  let info: Info;
  try {
    info = JSON.parse(jar.get(MFA_INFO_COOKIE)?.value ?? "");
  } catch {
    redirect("/login");
  }
  return (
    <main className="login">
      <div className="brand">
        <span className="mark" aria-hidden />
        <strong>StarX Kiosk</strong>
      </div>
      <div className="card stack" style={{ gap: 20 }}>
        <div>
          <h1>Confirme o acesso</h1>
          <p className="muted" style={{ margin: 0, fontSize: 12 }}>
            {info.emailHint
              ? info.codeSent
                ? `Enviamos um código de 8 caracteres para ${info.emailHint}. Ele vale por 10 minutos.`
                : `Um código já foi enviado para ${info.emailHint} há pouco. Use-o ou peça outro.`
              : "Sua conta não tem e-mail cadastrado: use um código de recuperação ou peça ao administrador."}
          </p>
        </div>
        <VerifyForm
          methods={info.methods}
          trustDays={info.trustDays}
          initialWaitSec={Math.max(0, Math.ceil((info.retryAfterSec || (info.codeSent ? 60 : 0)) - (Date.now() - info.at) / 1000))}
        />
      </div>
    </main>
  );
}
