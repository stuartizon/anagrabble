import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Show, useClerk, useUser } from "@clerk/react";
import styles from "./Header.module.css";
import { Wordmark } from "./Wordmark";

// `children` renders on the right side, matching design-system/In
// Game.dc.html's header layout (wordmark left, per-page content right —
// there it's bank count + menu/settings icons). Pages that don't need
// anything there (LobbyPage, NewGamePage) just omit children. AccountStatus
// renders alongside it by default — this is the one place login state shows
// up globally, rather than threading it through every page — except
// GameBoard, which hides it here via `hideAccountStatus` and surfaces the
// same <AccountStatus /> inside its mobile-only menu instead (an in-progress
// game's header is already tight on space, and there's no desktop
// equivalent yet — see docs/decisions.md "Auth provider").
export function Header({
  children,
  hideAccountStatus,
}: {
  children?: ReactNode;
  hideAccountStatus?: boolean;
}) {
  return (
    <header className={styles.header}>
      <Link to="/">
        <Wordmark size="md" />
      </Link>
      <div className={styles.actions}>
        {children}
        {!hideAccountStatus && <AccountStatus />}
      </div>
    </header>
  );
}

export function AccountStatus() {
  const { signOut } = useClerk();
  const { user } = useUser();
  const displayName = (user?.unsafeMetadata as { displayName?: string } | undefined)?.displayName;

  return (
    <>
      <Show when="signed-out">
        <Link to="/login" className={styles.accountLink}>
          Log in
        </Link>
      </Show>
      <Show when="signed-in">
        <span className={styles.accountName}>
          {displayName || user?.primaryEmailAddress?.emailAddress}
        </span>
        <button type="button" className={styles.accountLink} onClick={() => signOut()}>
          Log out
        </button>
      </Show>
    </>
  );
}
