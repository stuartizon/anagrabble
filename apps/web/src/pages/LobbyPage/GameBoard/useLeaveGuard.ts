import { useEffect, useState } from "react";

// Owns the mobile menu / leave-confirm dialog open state, plus the two
// non-click ways of leaving this page that a button's onClick can't catch:
// the browser's native "leave site?" prompt (beforeunload — closing the
// tab, refreshing, typing a new URL, following an external link) and the
// back/forward buttons (via a duplicate-history-entry trap on popstate).
// Doesn't need a "we're leaving on purpose" guard on beforeunload: every
// in-app way of leaving (confirming the dialog, or the game ending) is a
// client-side route change via react-router, which never fires
// `beforeunload` in the first place.
export function useLeaveGuard() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);

  // Closes the mobile menu underneath — design-system/In Game.dc.html's
  // openLeaveConfirm sets mobileMenuOpen: false (and settingsModalOpen:
  // false, once that not-yet-built story lands) in the same setState, so
  // the confirm dialog never stacks over the full-screen mobile menu.
  const openLeaveConfirm = () => {
    setLeaveConfirmOpen(true);
    setMenuOpen(false);
  };
  const closeLeaveConfirm = () => setLeaveConfirmOpen(false);

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

  return { menuOpen, setMenuOpen, leaveConfirmOpen, openLeaveConfirm, closeLeaveConfirm };
}
