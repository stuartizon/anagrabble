// Shared page-shell primitives — identical inline style blocks were
// previously duplicated verbatim across NewGamePage and every branch of
// LobbyPage (error / loading / main).

import type { ReactNode } from "react";
import styles from "./Layout.module.css";

export function PageShell({ children }: { children: ReactNode }) {
  return <div className={styles.pageShell}>{children}</div>;
}

export function CenteredContent({ children }: { children: ReactNode }) {
  return <div className={styles.centeredContent}>{children}</div>;
}

export function NarrowColumn({ children }: { children: ReactNode }) {
  return <div className={styles.narrowColumn}>{children}</div>;
}
