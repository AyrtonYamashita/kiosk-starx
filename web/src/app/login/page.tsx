import { LoginForm } from "./LoginForm";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ expirada?: string }> }) {
  const { expirada } = await searchParams;
  return (
    <main className="login">
      <div className="card stack">
        <h1>StarX Kiosk</h1>
        {expirada && <div className="alert warn">Sua sessão expirou. Entre de novo.</div>}
        <LoginForm />
      </div>
    </main>
  );
}
