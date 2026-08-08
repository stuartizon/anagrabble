// Ported from design-system/_ds/.../components/core/Card.jsx

import type { ReactNode } from "react";
import styles from "./Card.module.css";

interface CardProps {
  children: ReactNode;
  padding?: string;
}

export function Card({ children, padding }: CardProps) {
  return (
    <div className={styles.card} style={padding !== undefined ? { padding } : undefined}>
      {children}
    </div>
  );
}
