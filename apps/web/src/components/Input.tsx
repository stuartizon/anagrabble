// Ported from design-system/_ds/.../components/forms/Input.jsx

import { useState } from "react";

interface InputProps {
  label?: string;
  placeholder?: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  error?: string;
  size?: "md" | "lg";
}

export function Input({ label, placeholder, value, onChange, error, size = "md" }: InputProps) {
  const [focus, setFocus] = useState(false);
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: "6px", fontFamily: "var(--font-body)" }}>
      {label && (
        <span style={{ fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--text-secondary)" }}>{label}</span>
      )}
      <input
        value={value}
        placeholder={placeholder}
        onChange={onChange}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        style={{
          fontFamily: "var(--font-display)",
          fontSize: size === "lg" ? "var(--text-lg)" : "var(--text-base)",
          padding: size === "lg" ? "12px 14px" : "9px 12px",
          borderRadius: "var(--radius-md)",
          border: "1px solid " + (error ? "var(--error)" : focus ? "var(--accent)" : "var(--border)"),
          outline: "none",
          boxShadow: focus ? "var(--shadow-focus)" : "none",
          color: "var(--ink)",
          background: "var(--surface)",
          transition: "border-color 120ms ease-out, box-shadow 120ms ease-out",
        }}
      />
      {error && <span style={{ fontSize: "var(--text-xs)", color: "var(--error)" }}>{error}</span>}
    </label>
  );
}
