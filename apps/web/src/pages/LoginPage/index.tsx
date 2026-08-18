import { useState } from "react";
import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../../auth";
import { Header } from "../../components/Header";
import { Card } from "../../components/Card";
import { PageShell, PageContent, NarrowColumn } from "../../components/Layout";
import { AuthForm } from "./AuthForm";
import { VerificationForm } from "./VerificationForm";
import { ResetRequestForm } from "./ResetRequestForm";
import { ResetCodeForm } from "./ResetCodeForm";
import { useRedirectTarget } from "./useRedirectTarget";
import type { FieldErrors, Mode, ResetStep } from "./types";

// Matches design-system/Log in, Sign up.dc.html: Google + email/password,
// tabbed between log in and sign up, with a "Forgot password?" link that
// swaps the card into its third "reset" mode.
//
// Email verification-by-code on sign-up has no equivalent in the design
// mock (a fake localStorage demo, so it never needed one) — Clerk's default
// instance config requires it before a session exists, so it's an extra
// step layered on top of the design rather than a deviation from it.
//
// Reset mode deviates from the mock in the same spirit: the mock's
// "resetSent" step assumes a magic link ("Open reset link (demo)"), but
// Clerk's SPA custom-flow API resets via a one-time code entered inline
// (`reset_password_email_code`, the same shape as sign-up verification
// above) rather than a link, so the code step replaces it. It also skips
// the mock's "done" step and its "back to log in" framing: Clerk's
// Frontend API sets the real session cookie the moment
// `attemptFirstFactor` completes, independent of any `setActive` call —
// so calling `setActive` and redirecting straight in (matching each
// form's own submit handler) reflects what already happened rather than
// pretending the visitor is signed out when they aren't.
//
// Each screen (AuthForm/VerificationForm/ResetRequestForm/ResetCodeForm)
// owns its own field validation and Clerk network call — this component
// only owns the state that's genuinely shared across screens (typed-in
// field values persist across mode switches) and which screen is showing.

export function LoginPage() {
  const from = useRedirectTarget();
  const { isSignedIn } = useAuth();

  const [mode, setMode] = useState<Mode>("login");
  const [resetStep, setResetStep] = useState<ResetStep>("request");
  const [firstName, setFirstName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [code, setCode] = useState("");
  const [pendingVerification, setPendingVerification] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  if (isSignedIn) {
    return <Navigate to={from} replace />;
  }

  const switchMode = (next: Mode) => {
    setMode(next);
    setFieldErrors({});
  };

  const showReset = () => {
    setMode("reset");
    setResetStep("request");
    setFieldErrors({});
  };

  const backToLogin = () => {
    setMode("login");
    setResetStep("request");
    setCode("");
    setPassword("");
    setConfirmPassword("");
    setFieldErrors({});
  };

  let content: ReactNode;
  if (pendingVerification) {
    content = (
      <VerificationForm
        email={email}
        code={code}
        setCode={setCode}
        fieldErrors={fieldErrors}
        setFieldErrors={setFieldErrors}
      />
    );
  } else if (mode === "reset" && resetStep === "code") {
    content = (
      <ResetCodeForm
        email={email}
        code={code}
        setCode={setCode}
        password={password}
        setPassword={setPassword}
        confirmPassword={confirmPassword}
        setConfirmPassword={setConfirmPassword}
        fieldErrors={fieldErrors}
        setFieldErrors={setFieldErrors}
        onBack={backToLogin}
      />
    );
  } else if (mode === "reset") {
    content = (
      <ResetRequestForm
        email={email}
        setEmail={setEmail}
        fieldErrors={fieldErrors}
        setFieldErrors={setFieldErrors}
        setResetStep={setResetStep}
        onBack={backToLogin}
      />
    );
  } else {
    content = (
      <AuthForm
        mode={mode}
        switchMode={switchMode}
        showReset={showReset}
        firstName={firstName}
        setFirstName={setFirstName}
        email={email}
        setEmail={setEmail}
        password={password}
        setPassword={setPassword}
        fieldErrors={fieldErrors}
        setFieldErrors={setFieldErrors}
        setPendingVerification={setPendingVerification}
      />
    );
  }

  return (
    <PageShell>
      <Header />
      <PageContent>
        <NarrowColumn>
          <Card>{content}</Card>
        </NarrowColumn>
      </PageContent>
    </PageShell>
  );
}
