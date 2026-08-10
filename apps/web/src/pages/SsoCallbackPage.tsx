import { AuthenticateWithRedirectCallback } from "@clerk/react";
import { PageShell, CenteredContent } from "../components/Layout";

// Clerk redirects here mid-flow after "Continue with Google" (see
// LoginPage's OAUTH_REDIRECT_URL) — this component finishes the OAuth
// handshake and navigates on to whichever `from` path LoginPage passed as
// redirectUrlComplete itself.
export function SsoCallbackPage() {
  return (
    <PageShell>
      <CenteredContent>
        <AuthenticateWithRedirectCallback />
      </CenteredContent>
    </PageShell>
  );
}
