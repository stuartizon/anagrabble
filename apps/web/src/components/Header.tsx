import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import styles from "./Header.module.css";
import { Wordmark } from "./Wordmark";

// No account menu — auth is explicitly out of scope for this slice (see
// CLAUDE.md "Game rules" / the lobby-slice brief). Player identity is a
// local stub (see playerIdentity.ts), not a logged-in account.
//
// `children` renders on the right side, matching design-system/In
// Game.dc.html's header layout (wordmark left, per-page content right —
// there it's bank count + menu/settings icons). Pages that don't need
// anything there (LobbyPage, NewGamePage) just omit children.
export function Header({ children }: { children?: ReactNode }) {
  return (
    <header className={styles.header}>
      <Link to="/">
        <Wordmark size="md" />
      </Link>
      {children && <div className={styles.actions}>{children}</div>}
    </header>
  );
}
