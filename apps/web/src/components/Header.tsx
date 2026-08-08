import { Link } from "react-router-dom";
import { Wordmark } from "./Wordmark";

// No account menu — auth is explicitly out of scope for this slice (see
// CLAUDE.md "Game rules" / the lobby-slice brief). Player identity is a
// local stub (see playerIdentity.ts), not a logged-in account.
export function Header() {
  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "16px 24px",
        borderBottom: "1px solid var(--border)",
        background: "var(--surface-card)",
      }}
    >
      <Link to="/">
        <Wordmark size="md" />
      </Link>
    </header>
  );
}
