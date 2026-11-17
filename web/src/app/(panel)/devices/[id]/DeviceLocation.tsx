import { ago, dateTime } from "@/lib/format";

type Loc = { lat: number; lon: number; accuracyM: number | null; provider: string | null; at: string };

/**
 * Última posição informada pelo aparelho: mapa do OpenStreetMap (sem chave), precisão, idade e atalho para o
 * Google Maps. Coordenadas e precisão em mono (dado de máquina).
 */
export function DeviceLocation({ location, enabled }: { location: Loc | null; enabled: boolean }) {
  if (!enabled) return <span className="muted small">Desligado no perfil (Segurança → Enviar a localização ao painel).</span>;
  if (!location || typeof location.lat !== "number") {
    return (
      <span className="muted small">
        Ainda sem posição. O aparelho precisa da versão 0.4.4 ou mais nova, com localização ligada. Em ambiente fechado, sem serviços do Google, o GPS pode demorar
        ou não pegar.
      </span>
    );
  }
  const { lat, lon } = location;
  const d = 0.004;
  const embed = `https://www.openstreetmap.org/export/embed.html?bbox=${lon - d}%2C${lat - d}%2C${lon + d}%2C${lat + d}&layer=mapnik&marker=${lat}%2C${lon}`;
  const provider = location.provider === "gps" ? "GPS" : location.provider === "network" ? "rede (Wi-Fi/celular)" : (location.provider ?? "—");
  return (
    <div className="grid" style={{ gridTemplateColumns: "minmax(260px, 2fr) minmax(220px, 1fr)" }}>
      <iframe
        title="Mapa da localização do aparelho"
        src={embed}
        style={{ width: "100%", height: 280, border: "1px solid var(--line)", borderRadius: "var(--radius-field)" }}
        loading="lazy"
      />
      <dl className="kv">
        <dt>Coordenadas</dt>
        <dd className="mono">
          {lat.toFixed(6)}, {lon.toFixed(6)}
        </dd>
        <dt>Precisão</dt>
        <dd className="mono">{location.accuracyM !== null ? `± ${Math.round(location.accuracyM)} m` : "—"}</dd>
        <dt>Fonte</dt>
        <dd>{provider}</dd>
        <dt>Posição de</dt>
        <dd>
          {dateTime(location.at)} <span className="muted small">({ago(location.at)})</span>
        </dd>
        <dt />
        <dd>
          <a href={`https://www.google.com/maps?q=${lat},${lon}`} target="_blank" rel="noreferrer">
            Abrir no Google Maps
          </a>
        </dd>
      </dl>
    </div>
  );
}
