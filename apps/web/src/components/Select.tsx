// Ported from design-system/_ds/.../components/forms/Select.jsx

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
    <label style={{ display: "flex", flexDirection: "column", gap: "6px", fontFamily: "var(--font-body)" }}>
      {label && (
        <span style={{ fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--text-secondary)" }}>{label}</span>
      )}
      <select
        value={value}
        onChange={onChange}
        style={{
          fontFamily: "var(--font-body)",
          fontSize: "var(--text-base)",
          padding: "9px 12px",
          borderRadius: "var(--radius-md)",
          border: "1px solid var(--border)",
          background: "var(--surface)",
          color: "var(--ink)",
          outline: "none",
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
