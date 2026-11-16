import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/api";

/**
 * APK do app do kiosk para a instalação por USB (o navegador manda para o coletor via WebUSB).
 * O servidor do painel busca na API (mesmo arquivo do QR); só com sessão do painel.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  if (!/^[A-Za-z0-9._-]+\.apk$/.test(file)) return new Response("não encontrado", { status: 404 });
  if (!(await cookies()).get(SESSION_COOKIE)?.value) return new Response("sessão expirada", { status: 401 });
  const base = (process.env.API_URL ?? "").replace(/\/+$/, "");
  const res = await fetch(`${base}/apks/${file}`, { cache: "no-store" });
  if (!res.ok) return new Response("APK não encontrado no servidor", { status: 404 });
  return new Response(res.body, { headers: { "content-type": "application/vnd.android.package-archive", "cache-control": "no-store" } });
}
