import { AuthenticateWithRedirectCallback } from "../auth";
import { PageShell, PageContent } from "../components/Layout";

// Clerk redirects here mid-flow after "Continue with Google" (see
// LoginPage's OAUTH_REDIRECT_URL) — this component finishes the OAuth
// handshake and navigates on to whichever `from` path LoginPage passed as
// redirectUrlComplete itself.
//
// signInUrl/signUpUrl are this component's own props, separate from
// ClerkProvider's — without them, a flow that doesn't complete (e.g.
// cancelling the Google consent screen) has nowhere of ours to bail out to
// and falls back to Clerk's hosted Account Portal instead of /login.
export function SsoCallbackPage() {
  return (
    <PageShell>
      <PageContent>
        <AuthenticateWithRedirectCallback signInUrl="/login" signUpUrl="/login" />
      </PageContent>
    </PageShell>
  );
}
