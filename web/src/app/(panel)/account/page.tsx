import { PasswordForm } from "./PasswordForm";

export default function AccountPage() {
  return (
    <div className="stack" style={{ maxWidth: 480 }}>
      <h1>Conta</h1>
      <section className="card stack">
        <h2>Trocar senha</h2>
        <PasswordForm />
      </section>
    </div>
  );
}
