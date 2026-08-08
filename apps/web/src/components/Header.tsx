import { Link } from "react-router-dom";
import styles from "./Header.module.css";
import { Wordmark } from "./Wordmark";

// No account menu — auth is explicitly out of scope for this slice (see
// CLAUDE.md "Game rules" / the lobby-slice brief). Player identity is a
// local stub (see playerIdentity.ts), not a logged-in account.
export function Header() {
  return (
    <header className={styles.header}>
      <Link to="/">
        <Wordmark size="md" />
      </Link>
    </header>
  );
}
