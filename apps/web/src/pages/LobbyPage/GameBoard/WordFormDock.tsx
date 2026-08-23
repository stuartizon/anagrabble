import type { RefObject } from "react";
import { Input } from "../../../components/Input";
import { Button } from "../../../components/Button";
import styles from "./GameBoard.module.css";

interface WordFormDockProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  inputRef: RefObject<HTMLInputElement>;
}

// Word input is English-only by design — filters every keystroke to
// uppercase A-Z rather than accepting then rejecting on submit.
export function WordFormDock({ value, onChange, onSubmit, inputRef }: WordFormDockProps) {
  return (
    <div className={styles.wordFormDock}>
      <form className={styles.wordForm} onSubmit={onSubmit}>
        <div className={styles.wordFormInput}>
          <Input
            ref={inputRef}
            value={value}
            onChange={(e) => onChange(e.target.value.toUpperCase().replace(/[^A-Z]/g, ""))}
            placeholder="Type a word…"
            size="lg"
            mono
          />
        </div>
        <Button type="submit" size="lg">
          Play word
        </Button>
      </form>
    </div>
  );
}
