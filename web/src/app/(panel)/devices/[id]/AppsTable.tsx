"use client";

import { Toggle } from "@/components/Toggle";
import { useMemo, useState } from "react";
import type { DeviceDetail } from "@/lib/api";

export function AppsTable({ apps }: { apps: DeviceDetail["apps"] }) {
  const [query, setQuery] = useState("");
  const [showSystem, setShowSystem] = useState(false);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return apps
      .filter((a) => showSystem || !a.system)
      .filter((a) => !q || a.packageName.toLowerCase().includes(q) || (a.label ?? "").toLowerCase().includes(q))
      .sort((a, b) => (a.label ?? a.packageName).localeCompare(b.label ?? b.packageName, "pt-BR"));
  }, [apps, query, showSystem]);
  if (apps.length === 0) return <span className="muted">O aparelho ainda não enviou a lista de apps.</span>;
  return (
    <>
      <div className="row">
        <input placeholder="Buscar app ou pacote" value={query} onChange={(e) => setQuery(e.target.value)} style={{ maxWidth: 320 }} />
        <label className="check-label">
          <Toggle checked={showSystem} onCheckedChange={setShowSystem} /> mostrar apps do sistema
        </label>
        <span className="muted small">{filtered.length} exibidos</span>
      </div>
      <div className="table-wrap" style={{ maxHeight: 420, overflowY: "auto" }}>
        <table>
          <thead>
            <tr>
              <th>App</th>
              <th>Pacote</th>
              <th>Versão</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((a) => (
              <tr key={a.packageName}>
                <td>
                  {a.label ?? a.packageName} {a.system && <span className="badge off">sistema</span>}
                </td>
                <td className="mono small">{a.packageName}</td>
                <td className="small">
                  {a.versionName ?? "—"} <span className="muted">({a.versionCode ?? "?"})</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
