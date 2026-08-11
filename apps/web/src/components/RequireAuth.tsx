import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../auth";
import { PageShell } from "./Layout";
import { Header } from "./Header";

// Gates a route on being signed in — no anonymous play. Redirects to
// /login, remembering the page the visitor meant to reach (LoginPage reads
// location.state?.from to send them back after signing in).
export function RequireAuth({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();
  const location = useLocation();

  if (!isLoaded) {
    return (
      <PageShell>
        <Header />
      </PageShell>
    );
  }

  if (!isSignedIn) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <>{children}</>;
}
