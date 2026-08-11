import { useEffect } from "react";

// 100dvh accounts for the browser's address bar but not the on-screen
// keyboard — mobile browsers leave the layout viewport (and therefore dvh)
// at its full height when the keyboard opens, so a fixed-height page has to
// be scrolled by the OS to keep a focused input visible, hiding whatever's
// above it. window.visualViewport, unlike dvh, does correctly report the
// shrunk visible height, so this tracks it into a CSS custom property on the
// root element for CSS to consume via `var(--app-height, 100dvh)` — falling
// back to the static value before this effect runs, or where visualViewport
// isn't available at all.
export function useVisualViewportHeight(cssVar: string) {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const root = document.documentElement;
    const setHeight = () => {
      root.style.setProperty(cssVar, `${viewport.height}px`);
      window.scrollTo(0, 0);
    };
    setHeight();
    viewport.addEventListener("resize", setHeight);
    return () => {
      viewport.removeEventListener("resize", setHeight);
      root.style.removeProperty(cssVar);
    };
  }, [cssVar]);
}
