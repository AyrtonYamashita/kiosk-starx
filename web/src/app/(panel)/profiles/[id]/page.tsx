import Link from "next/link";
import { notFound } from "next/navigation";
import { api, ApiError, type CatalogApp, type Profile, type RepoApp } from "@/lib/api";
import { DeleteProfile } from "./DeleteProfile";
import { ProfileForm } from "../ProfileForm";

export const dynamic = "force-dynamic";

export default async function ProfilePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ salvo?: string }> }) {
  const { id } = await params;
  const { salvo } = await searchParams;
  let profile: Profile;
  try {
    profile = await api<Profile>(`/v1/admin/profiles/${id}`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
  const [{ apps }, { apps: repo }] = await Promise.all([
    api<{ apps: CatalogApp[] }>("/v1/admin/apps-catalog"),
    api<{ apps: RepoApp[] }>("/v1/admin/apps"),
  ]);
  return (
    <div className="stack">
      <Link href="/profiles" className="muted">
        ← Perfis
      </Link>
      <h1>{profile.name}</h1>
      <ProfileForm profile={profile} catalog={apps} repo={repo} justSaved={!!salvo} />

      <section className="card stack">
        <h2>Aparelhos com este perfil ({profile.deviceList?.length ?? 0})</h2>
        {profile.deviceList?.length ? (
          <div className="row">
            {profile.deviceList.map((d) => (
              <Link key={d.id} href={`/devices/${d.id}`} className="badge off">
                {d.name}
              </Link>
            ))}
          </div>
        ) : (
          <span className="muted small">Nenhum. Atribua na lista de Aparelhos (seleção em lote) ou na página do aparelho.</span>
        )}
        <DeleteProfile id={profile.id} name={profile.name} devices={profile.devices} />
      </section>
    </div>
  );
}
