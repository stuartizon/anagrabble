import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Show, useClerk, useUser } from "../auth";
import styles from "./Header.module.css";
import { Wordmark } from "./Wordmark";
import { getDisplayName } from "../clerkDisplayName";

// `children` renders on the right side, defaulting to AccountStatus (login
// state) — this is the one place that shows up globally, rather than
// threading it through every page. A caller that passes its own children
// replaces the default entirely rather than appending to it: GameBoard is
// the only current example, showing bank count + menu button instead —
// design-system/In Game.dc.html has no account/login element anywhere in
// its header or its mobile menu (Players/Invite/Game settings/Your
// settings only), so an in-progress game shows no account status at all.
export function Header({ children }: { children?: ReactNode }) {
  return (
    <header className={styles.header}>
      <Link to="/">
        <Wordmark size="md" />
      </Link>
      <div className={styles.actions}>{children ?? <AccountStatus />}</div>
    </header>
  );
}

// Matches design-system/New Game.dc.html's header avatar: a round
// accent-green button showing the user's initial, opening a small dropdown
// (name/email, Stats, Log out) on click. The design's dropdown also has a
// Settings link — left out here since that page doesn't exist yet (a
// separate, not-yet-started user story).
function AccountStatus() {
  const { signOut } = useClerk();
  const { user } = useUser();
  const [menuOpen, setMenuOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const label = getDisplayName(user);

  useEffect(() => {
    if (!menuOpen) return;
    const closeIfOutside = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("click", closeIfOutside);
    return () => document.removeEventListener("click", closeIfOutside);
  }, [menuOpen]);

  return (
    <>
      <Show when="signed-out">
        <Link to="/login" className={styles.accountLink}>
          Log in
        </Link>
      </Show>
      <Show when="signed-in">
        <div className={styles.avatarWrapper} ref={containerRef}>
          <button
            type="button"
            className={styles.avatarButton}
            aria-label="Account menu"
            onClick={() => setMenuOpen((open) => !open)}
          >
            {label.charAt(0).toUpperCase()}
          </button>
          {menuOpen && (
            <div className={styles.avatarMenu}>
              <div className={styles.avatarMenuName}>{label}</div>
              <Link
                to="/stats"
                className={styles.avatarMenuLink}
                onClick={() => setMenuOpen(false)}
              >
                Stats
              </Link>
              <button type="button" className={styles.avatarMenuLogout} onClick={() => signOut()}>
                Log out
              </button>
            </div>
          )}
        </div>
      </Show>
    </>
  );
}
