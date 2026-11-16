import { LoginForm } from "./LoginForm";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ expirada?: string }> }) {
  const { expirada } = await searchParams;
  return (
    <main className="login">
      <div className="brand">
        <span className="mark" aria-hidden />
        <strong>StarX Kiosk</strong>
      </div>
      <div className="card stack" style={{ gap: 20 }}>
        <div>
          <h1>Entrar</h1>
          <p className="muted" style={{ margin: 0, fontSize: 12 }}>
            Painel dos aparelhos StarX Kiosk.
          </p>
        </div>
        {expirada && <div className="alert warn">Sua sessão expirou. Entre de novo.</div>}
        <LoginForm />
      </div>
    </main>
  );
}
