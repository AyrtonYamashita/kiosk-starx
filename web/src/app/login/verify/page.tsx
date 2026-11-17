import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { MFA_COOKIE, MFA_INFO_COOKIE } from "@/lib/api";
import { VerifyForm } from "./VerifyForm";

export const dynamic = "force-dynamic";

type Info = { methods: ("passkey" | "totp" | "email" | "recovery")[]; emailHint: string | null; codeSent: boolean; retryAfterSec: number; trustDays: number; at: number };

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
        <VerifyForm
          methods={info.methods}
          emailHint={info.emailHint}
          codeSent={info.codeSent}
          trustDays={info.trustDays}
          initialWaitSec={Math.max(0, Math.ceil((info.retryAfterSec || (info.codeSent ? 60 : 0)) - (Date.now() - info.at) / 1000))}
        />
      </div>
    </main>
  );
}
