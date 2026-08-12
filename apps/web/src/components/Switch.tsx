// Ported from design-system/_ds/.../components/forms/Switch.jsx (compiled
// into _ds_bundle.js — no standalone .jsx file survives, but the real
// component source is inlined there) — 38x22px track, var(--neutral-500)
// off / var(--accent) on, an 18x18 thumb inset 2px with a thin
// var(--border-strong) ring, sliding via `left` (2px off, 18px on).

import styles from "./Switch.module.css";

interface SwitchProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: string;
}

export function Switch({ checked, onChange, label }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={styles.track}
      data-checked={checked || undefined}
      onClick={() => onChange(!checked)}
    >
      <span className={styles.thumb} />
    </button>
  );
}
