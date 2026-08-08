// Ported from design-system/_ds/.../components/core/Button.jsx

import { useState, type CSSProperties, type ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

interface ButtonProps {
  variant?: Variant;
  size?: Size;
  disabled?: boolean;
  children: ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  style?: CSSProperties;
}

const sizeMap: Record<Size, { padding: string; font: string }> = {
  sm: { padding: "6px 12px", font: "var(--text-sm)" },
  md: { padding: "10px 18px", font: "var(--text-base)" },
  lg: { padding: "13px 24px", font: "var(--text-lg)" },
};

export function Button({
  variant = "primary",
  size = "md",
  disabled = false,
  children,
  onClick,
  type = "button",
  style,
}: ButtonProps) {
  const [hover, setHover] = useState(false);
  const [active, setActive] = useState(false);
  const s = sizeMap[size];

  const base: CSSProperties = {
    fontFamily: "var(--font-body)",
    fontWeight: 600,
    fontSize: s.font,
    padding: s.padding,
    borderRadius: "var(--radius-md)",
    border: "1px solid transparent",
    cursor: disabled ? "not-allowed" : "pointer",
    display: "inline-flex",
    alignItems: "center",
    gap: "8px",
    transition: "background-color 140ms ease-out, border-color 140ms ease-out, transform 100ms ease-out",
    transform: active && !disabled ? "translateY(1px)" : "none",
    opacity: disabled ? 0.5 : 1,
  };

  const variants: Record<Variant, CSSProperties> = {
    primary: {
      background: hover && !disabled ? "var(--accent-dark)" : "var(--accent)",
      color: "var(--text-on-accent)",
    },
    secondary: {
      background: hover && !disabled ? "var(--surface-sunken)" : "var(--surface)",
      color: "var(--ink)",
      borderColor: hover && !disabled ? "var(--border-strong)" : "var(--border)",
    },
    ghost: {
      background: hover && !disabled ? "var(--surface-sunken)" : "transparent",
      color: "var(--ink)",
    },
    danger: {
      background: hover && !disabled ? "#A3392A" : "var(--error)",
      color: "#fff",
    },
  };

  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => {
        setHover(false);
        setActive(false);
      }}
      onMouseDown={() => setActive(true)}
      onMouseUp={() => setActive(false)}
      style={{ ...base, ...variants[variant], ...style }}
    >
      {children}
    </button>
  );
}
