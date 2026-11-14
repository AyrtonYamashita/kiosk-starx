import Link from "next/link";
import { api, type CatalogApp } from "@/lib/api";
import { ProfileForm } from "../ProfileForm";

export const dynamic = "force-dynamic";

export default async function NewProfilePage() {
  const { apps } = await api<{ apps: CatalogApp[] }>("/v1/admin/apps-catalog");
  return (
    <div className="stack">
      <Link href="/profiles" className="muted">
        ← Perfis
      </Link>
      <h1>Novo perfil</h1>
      <ProfileForm profile={null} catalog={apps} />
    </div>
  );
}
