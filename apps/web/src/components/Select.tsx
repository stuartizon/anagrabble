// Ported from design-system/_ds/.../components/forms/Select.jsx

import { ChevronDown } from "lucide-react";
import styles from "./Select.module.css";

interface SelectOption {
  label: string;
  value: string;
}

interface SelectProps {
  label?: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  options: SelectOption[];
}

export function Select({ label, value, onChange, options }: SelectProps) {
  return (
    <label className={styles.label}>
      {label && <span className={styles.labelText}>{label}</span>}
      <span className={styles.wrapper}>
        <select className={styles.select} value={value} onChange={onChange}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <ChevronDown className={styles.chevron} size={20} strokeWidth={1.5} aria-hidden="true" />
      </span>
    </label>
  );
}
