import { useEffect, useState } from "react";

// Owns which one of GameBoard's three mutually-exclusive overlays (mobile
// menu, settings modal, leave-confirm dialog) is open, plus the two
// non-click ways of leaving this page that a button's onClick can't catch:
// the browser's native "leave site?" prompt (beforeunload — closing the
// tab, refreshing, typing a new URL, following an external link) and the
// back/forward buttons (via a duplicate-history-entry trap on popstate).
// Doesn't need a "we're leaving on purpose" guard on beforeunload: every
// in-app way of leaving (confirming the dialog, or the game ending) is a
// client-side route change via react-router, which never fires
// `beforeunload` in the first place.
//
// A single `overlay` field, rather than one boolean per overlay, matches
// design-system/In Game.dc.html's own openLeaveConfirm (which sets
// mobileMenuOpen: false and settingsModalOpen: false in the same setState
// as opening the confirm dialog, so it never stacks over either) — opening
// any one of the three always replaces whatever was open, never adds to
// it, so the three can't drift into an impossible combined state (e.g. the
// back-button trap firing openLeaveConfirm while the settings modal is
// still open underneath it).
type Overlay = "menu" | "settings" | "leaveConfirm" | null;

export function useLeaveGuard() {
  const [overlay, setOverlay] = useState<Overlay>(null);

  const openMenu = () => setOverlay("menu");
  const closeMenu = () => setOverlay(null);
  const openSettings = () => setOverlay("settings");
  const closeSettings = () => setOverlay(null);
  const openLeaveConfirm = () => setOverlay("leaveConfirm");
  const closeLeaveConfirm = () => setOverlay(null);

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  // The one way of leaving this page that neither a click handler nor
  // `beforeunload` can catch: react-router's <BrowserRouter> handles
  // back/forward via the History API's `popstate` entirely client-side, so
  // the page never unloads and `beforeunload` never fires for it.
  //
  // The trick: push a duplicate history entry on mount, so the browser's
  // "back" always has a same-URL entry to land on first. Landing there
  // fires `popstate` (letting us intercept it and show the dialog) without
  // the URL actually changing, and re-arms the trap immediately so repeated
  // back-presses keep re-opening the dialog instead of ever slipping
  // through. Confirming leave navigates away explicitly via the caller's
  // own onLeaveGame handler passed to LeaveGameConfirm, same as the
  // button/wordmark paths — this effect only re-arms the trap, it never
  // itself decides to leave.
  //
  // Known tradeoff: the duplicate entry isn't cleaned up on unmount (there's
  // no way to "pop" it without also moving the real history position), so
  // it can linger after a confirmed leave — landing back on this game's URL
  // and remounting it, same as reloading that link directly, rather than
  // continuing further back. Not a broken state, just one extra back-press
  // occasionally required.
  useEffect(() => {
    window.history.pushState(null, "", window.location.href);
    const onPopState = () => {
      window.history.pushState(null, "", window.location.href);
      openLeaveConfirm();
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  return {
    menuOpen: overlay === "menu",
    openMenu,
    closeMenu,
    settingsOpen: overlay === "settings",
    openSettings,
    closeSettings,
    leaveConfirmOpen: overlay === "leaveConfirm",
    openLeaveConfirm,
    closeLeaveConfirm,
  };
}
