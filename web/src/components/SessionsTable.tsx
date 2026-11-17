import { revokeSession } from "@/lib/actions";
import type { SessionInfo } from "@/lib/api";
import { ago, dateTime } from "@/lib/format";

/** Navegador e sistema, a partir do user agent (resumo legível). */
function device(ua: string | null): string {
  if (!ua) return "—";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Navegador";
  const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Mac OS/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} · ${os}` : browser;
}

export function SessionsTable({ sessions, showUser = false }: { sessions: SessionInfo[]; showUser?: boolean }) {
  if (sessions.length === 0) return <span className="muted small">Nenhuma sessão ativa.</span>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {showUser && <th>Usuário</th>}
            <th>Navegador</th>
            <th>IP</th>
            <th>Último uso</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {sessions.map((s) => (
            <tr key={s.id}>
              {showUser && <td className="mono">{s.username}</td>}
              <td>
                {device(s.userAgent)} {s.current && <span className="badge ok">esta</span>}
                <div className="muted small">desde {dateTime(s.createdAt)}</div>
              </td>
              <td className="mono">{s.ip ?? "—"}</td>
              <td className="small">{ago(s.lastUsedAt)}</td>
              <td style={{ textAlign: "right" }}>
                {!s.current && (
                  <form action={revokeSession}>
                    <input type="hidden" name="id" value={s.id} />
                    <button className="danger">Encerrar</button>
                  </form>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
