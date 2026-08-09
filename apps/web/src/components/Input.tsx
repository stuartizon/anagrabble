// Ported from design-system/_ds/.../components/forms/Input.jsx — focus
// state is a real :focus pseudo-class here instead of useState (the source
// tracks it in JS since inline styles can't express :focus).

import { forwardRef } from "react";
import styles from "./Input.module.css";
import { cx } from "../cx";

interface InputProps {
  label?: string;
  placeholder?: string;
  value: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  error?: string;
  size?: "md" | "lg";
  disabled?: boolean;
  mono?: boolean;
  autoFocus?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, placeholder, value, onChange, error, size = "md", disabled, mono, autoFocus },
  ref,
) {
  return (
    <label className={styles.label}>
      {label && <span className={styles.labelText}>{label}</span>}
      <input
        ref={ref}
        className={cx(
          styles.input,
          size === "lg" && styles.lg,
          error && styles.error,
          disabled && styles.disabled,
          mono && styles.mono,
        )}
        value={value}
        placeholder={placeholder}
        onChange={onChange}
        disabled={disabled}
        autoFocus={autoFocus}
      />
      {error && <span className={styles.errorText}>{error}</span>}
    </label>
  );
});
