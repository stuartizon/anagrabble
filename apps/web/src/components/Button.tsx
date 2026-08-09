// Ported from design-system/_ds/.../components/core/Button.jsx. The source
// tracks hover/press via useState because inline styles can't express
// :hover — with a real stylesheet available, that state boilerplate goes
// away in favor of &:hover / &:active.

import type { ReactNode } from "react";
import styles from "./Button.module.css";
import { cx } from "../cx";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

interface ButtonProps {
  variant?: Variant;
  size?: Size;
  disabled?: boolean;
  children: ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  fullWidth?: boolean;
}

export function Button({
  variant = "primary",
  size = "md",
  disabled = false,
  children,
  onClick,
  type = "button",
  fullWidth,
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={cx(styles.button, styles[size], styles[variant], fullWidth && styles.fullWidth)}
    >
      {children}
    </button>
  );
}
