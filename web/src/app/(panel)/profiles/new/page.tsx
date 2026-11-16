import Link from "next/link";
import { api, type CatalogApp, type RepoApp } from "@/lib/api";
import { ProfileForm } from "../ProfileForm";

export const dynamic = "force-dynamic";

export default async function NewProfilePage() {
  const [{ apps }, { apps: repo }] = await Promise.all([
    api<{ apps: CatalogApp[] }>("/v1/admin/apps-catalog"),
    api<{ apps: RepoApp[] }>("/v1/admin/apps"),
  ]);
  return (
    <div className="stack">
      <Link href="/profiles" className="muted">
        ← Perfis
      </Link>
      <h1>Novo perfil</h1>
      <ProfileForm profile={null} catalog={apps} repo={repo} />
    </div>
  );
}
