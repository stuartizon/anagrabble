// Ported from design-system/_ds/.../components/game/PlayerChip.jsx

interface PlayerChipProps {
  name: string;
  score: number;
  color?: string;
  isTurn?: boolean;
}

export function PlayerChip({ name, score, color = "var(--accent)", isTurn = false }: PlayerChipProps) {
  return (
    <span
      style={{
        display: "flex",
        alignItems: "center",
        gap: "7px",
        flexShrink: 0,
        padding: "4px 2px 6px",
        borderBottom: "2px solid " + (isTurn ? color : "transparent"),
        fontFamily: "var(--font-body)",
      }}
    >
      <span style={{ width: 9, height: 9, borderRadius: "2px", background: color, flexShrink: 0 }} />
      <span style={{ fontWeight: 600, fontSize: "var(--text-sm)", color: "var(--ink)" }}>{name}</span>
      <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "var(--text-sm)", color: "var(--gold)" }}>
        {score}
      </span>
    </span>
  );
}
