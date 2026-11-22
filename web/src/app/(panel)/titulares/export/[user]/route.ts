import { api, ApiError } from "@/lib/api";

/** Baixa o JSON com todos os dados de um colaborador (LGPD, Art. 18, II e V). A API exige administrador. */
export async function GET(_req: Request, { params }: { params: Promise<{ user: string }> }) {
  const { user } = await params;
  try {
    const data = await api<unknown>(`/v1/admin/privacy/subjects/${encodeURIComponent(user)}/export`);
    const day = new Date().toISOString().slice(0, 10);
    const safe = user.replace(/[^\w.-]/g, "_");
    return new Response(JSON.stringify(data, null, 2), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="dados-${safe}-${day}.json"`,
        "cache-control": "no-store",
      },
    });
  } catch (e) {
    const status = e instanceof ApiError ? e.status : 500;
    return new Response(status === 404 ? "Nenhum dado com esse usuário do SSW." : status === 403 ? "Só administradores." : "Falha ao exportar.", {
      status,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
}
