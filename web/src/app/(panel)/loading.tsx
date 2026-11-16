/**
 * Esqueleto mostrado na hora do clique, enquanto o servidor busca os dados da próxima tela
 * (mesmo padrão do design system: blocos na cor da divisória, cartão com borda, "respirando").
 */
export default function Loading() {
  return (
    <div className="stack" role="status" aria-label="Carregando">
      <div className="skeleton" style={{ width: 220, height: 28 }} />
      <div className="card stack" style={{ padding: 0, gap: 0 }}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--rule)" }}>
          <div className="skeleton" style={{ width: 140, height: 12 }} />
        </div>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} style={{ padding: "14px 16px", borderBottom: i < 3 ? "1px solid var(--subtle)" : undefined, display: "flex", gap: 16 }}>
            <div className="skeleton" style={{ width: "28%", height: 12 }} />
            <div className="skeleton" style={{ width: "16%", height: 12 }} />
            <div className="skeleton" style={{ width: "22%", height: 12 }} />
          </div>
        ))}
      </div>
    </div>
  );
}
