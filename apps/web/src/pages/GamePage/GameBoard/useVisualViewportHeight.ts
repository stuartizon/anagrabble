import { useEffect } from "react";

// Neither iOS Safari nor Android Chrome without interactive-widget=
// resizes-content shrink the *layout* viewport (or dvh) when the on-screen
// keyboard opens — only the visual viewport shrinks, and the browser then
// scrolls the document to keep the focused input in view, taking
// everything above it (header, upturned tiles) off-screen along the way.
// Mirroring the real visible height onto --visual-vh, and cancelling the
// browser's own compensating scroll, lets .page's flex column shrink to
// the actually-visible area itself, so there's nothing left for the
// browser to scroll to reveal the input.
export function useVisualViewportHeight() {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;

    const sync = () => {
      document.documentElement.style.setProperty("--visual-vh", `${viewport.height}px`);
      window.scrollTo(0, 0);
    };

    sync();
    viewport.addEventListener("resize", sync);
    viewport.addEventListener("scroll", sync);
    return () => {
      viewport.removeEventListener("resize", sync);
      viewport.removeEventListener("scroll", sync);
    };
  }, []);
}
