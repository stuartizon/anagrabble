// Ported from design-system/_ds/.../components/brand/Wordmark.jsx — see
// CLAUDE.md "Design system" (typographic wordmark only, no logo asset).

interface WordmarkProps {
  size?: "sm" | "md" | "lg";
  color?: string;
}

export function Wordmark({ size = "md", color }: WordmarkProps) {
  const px = size === "sm" ? 16 : size === "lg" ? 32 : 22;
  return (
    <span
      style={{
        fontFamily: "var(--font-display)",
        fontWeight: 600,
        fontSize: px,
        letterSpacing: "var(--tracking-wide)",
        color: color || "var(--ink)",
      }}
    >
      anagrabble
    </span>
  );
}
