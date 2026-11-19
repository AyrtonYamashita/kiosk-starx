import { StarxLogo } from "@/components/brand/Logo";
import { LoginForm } from "./LoginForm";
import { PasskeyLogin } from "./PasskeyLogin";

const ETAPA: Record<string, string> = {
  expirou: "A confirmação do código expirou. Entre de novo.",
  tentativas: "Muitos códigos errados. Entre de novo com a senha.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ expirada?: string; etapa?: string }> }) {
  const { expirada, etapa } = await searchParams;
  return (
    <main className="login">
      <div className="brand">
        <StarxLogo size={36} />
      </div>
      <div className="card stack" style={{ gap: 20 }}>
        <div>
          <h1>Entrar</h1>
          <p className="muted" style={{ margin: 0, fontSize: 12 }}>
            Painel dos aparelhos Starx Kiosk.
          </p>
        </div>
        {expirada && <div className="alert warn">Sua sessão expirou. Entre de novo.</div>}
        {etapa && ETAPA[etapa] && <div className="alert warn">{ETAPA[etapa]}</div>}
        <LoginForm />
        <PasskeyLogin />
      </div>
    </main>
  );
}
