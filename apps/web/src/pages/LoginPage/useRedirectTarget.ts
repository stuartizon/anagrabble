import { useLocation } from "react-router-dom";
import type { Location } from "react-router-dom";

// RequireAuth redirects a signed-out visitor to /login with the page they
// meant to reach in location.state.from — this reads that back so a
// completed sign-in/sign-up/reset can send them on to it instead of always
// landing on "/". A hook rather than a prop threaded down from LoginPage:
// every screen's own submit handler needs it to navigate on success, and
// useLocation() returns the same value everywhere under this route either
// way, so recomputing it locally avoids passing it through every form.
export function useRedirectTarget(): string {
  const location = useLocation();
  return (location.state as { from?: Location } | null)?.from?.pathname ?? "/";
}
