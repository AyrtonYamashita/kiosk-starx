import { api, type Me } from "@/lib/api";

/** "Baixar meus dados": o usuário do painel baixa os próprios dados (LGPD, Art. 18, II e V), sem segredos. */
export async function GET() {
  const [me, data] = await Promise.all([api<Me>("/v1/admin/me"), api<unknown>("/v1/admin/me/export")]);
  const day = new Date().toISOString().slice(0, 10);
  const safe = me.username.replace(/[^\w.-]/g, "_");
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="meus-dados-${safe}-${day}.json"`,
      "cache-control": "no-store",
    },
  });
}
