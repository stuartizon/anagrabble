// Ported from design-system/_ds/.../components/core/Card.jsx

import type { ReactNode } from "react";

interface CardProps {
  children: ReactNode;
  padding?: string;
}

export function Card({ children, padding = "var(--space-5)" }: CardProps) {
  return (
    <div
      style={{
        background: "var(--surface-card)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-lg)",
        boxShadow: "var(--shadow-sm)",
        padding,
      }}
    >
      {children}
    </div>
  );
}
