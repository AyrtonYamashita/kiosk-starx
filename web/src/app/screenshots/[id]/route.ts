import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/api";

/** Imagem da captura de tela: o servidor do painel busca na API com a sessão (o navegador não fala com a API). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("não encontrado", { status: 404 });
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return new Response("sessão expirada", { status: 401 });
  const base = (process.env.API_URL ?? "").replace(/\/+$/, "");
  const res = await fetch(`${base}/v1/admin/screenshots/${id}`, { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
  if (!res.ok) return new Response("não encontrado", { status: res.status === 401 ? 401 : 404 });
  return new Response(res.body, {
    headers: { "content-type": res.headers.get("content-type") ?? "image/jpeg", "cache-control": "private, max-age=86400" },
  });
}
