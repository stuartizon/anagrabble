import { useState } from "react";
import type { FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import type { Location } from "react-router-dom";
import { useAuth, useSignIn, useSignUp, mockUsers, quickSignIn } from "../auth";
import { Header } from "../components/Header";
import { Card } from "../components/Card";
import { Input } from "../components/Input";
import { Button } from "../components/Button";
import { PageShell, PageContent, NarrowColumn } from "../components/Layout";
import { cx } from "../cx";
import styles from "./LoginPage.module.css";

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
// so calling `setActive` and redirecting straight in (matching
// submitLogin/submitVerification below) reflects what already happened
// rather than pretending the visitor is signed out when they aren't.

type Mode = "login" | "signup" | "reset";
type ResetStep = "request" | "code";

const OAUTH_REDIRECT_URL = "/sso-callback";

// Which field an error belongs to, "form" being a catch-all banner for
// errors that aren't about any single field (e.g. an OAuth redirect
// failure, or a Clerk error code we don't have a mapping for).
type FieldKey = "firstName" | "email" | "password" | "confirmPassword" | "code" | "form";
type FieldErrors = Partial<Record<FieldKey, string>>;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Clerk's API errors carry a `meta.paramName` identifying which submitted
// field the error is about (e.g. "identifier" for "no such account",
// "password" for "wrong password" or "too short") — this repo's forms
// reuse `password` for both the login/signup password field and the
// reset flow's "New password" field, so both route here correctly.
function fieldForParamName(paramName: string | undefined): FieldKey {
  switch (paramName) {
    case "identifier":
    case "email_address":
      return "email";
    case "password":
      return "password";
    case "code":
      return "code";
    case "first_name":
      return "firstName";
    default:
      return "form";
  }
}

function fieldErrorsFromClerkError(err: unknown): FieldErrors {
  const clerkError = err as {
    errors?: Array<{ message: string; longMessage?: string; meta?: { paramName?: string } }>;
  };
  const errors = clerkError.errors ?? [];
  if (errors.length === 0) return { form: "Something went wrong." };
  const result: FieldErrors = {};
  for (const error of errors) {
    result[fieldForParamName(error.meta?.paramName)] = error.longMessage ?? error.message;
  }
  return result;
}

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: Location } | null)?.from?.pathname ?? "/";
  const { isSignedIn } = useAuth();
  const { isLoaded: signInLoaded, signIn, setActive: setActiveSignIn } = useSignIn();
  const { isLoaded: signUpLoaded, signUp, setActive: setActiveSignUp } = useSignUp();

  const [mode, setMode] = useState<Mode>("login");
  const [resetStep, setResetStep] = useState<ResetStep>("request");
  const [firstName, setFirstName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [code, setCode] = useState("");
  const [pendingVerification, setPendingVerification] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);

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

  const signInWithGoogle = async () => {
    if (!signInLoaded) return;
    setFieldErrors({});
    try {
      await signIn.authenticateWithRedirect({
        strategy: "oauth_google",
        redirectUrl: OAUTH_REDIRECT_URL,
        redirectUrlComplete: from,
      });
    } catch (err) {
      setFieldErrors(fieldErrorsFromClerkError(err));
    }
  };

  const signInAsDevUser = (user: (typeof mockUsers)[number]) => {
    quickSignIn?.(user);
    navigate(from, { replace: true });
  };

  const submitLogin = async () => {
    if (!signInLoaded) return;
    const result = await signIn.create({
      strategy: "password",
      identifier: email.trim(),
      password,
    });
    if (result.status === "complete") {
      await setActiveSignIn({ session: result.createdSessionId });
      navigate(from, { replace: true });
      return;
    }
    setFieldErrors({ form: "Couldn't log you in — check your email and password." });
  };

  const submitSignup = async () => {
    if (!signUpLoaded) return;
    const result = await signUp.create({
      emailAddress: email.trim(),
      password,
      firstName: firstName.trim(),
    });
    if (result.status === "complete") {
      await setActiveSignUp({ session: result.createdSessionId });
      navigate(from, { replace: true });
      return;
    }
    // Default Clerk instance config requires verifying the email address
    // before a session can be created.
    await signUp.prepareEmailAddressVerification({ strategy: "email_code" });
    setPendingVerification(true);
  };

  const requestReset = async (e: FormEvent) => {
    e.preventDefault();
    if (!signInLoaded) return;
    if (!email.trim()) {
      setFieldErrors({ email: "Required" });
      return;
    }
    if (!EMAIL_PATTERN.test(email.trim())) {
      setFieldErrors({ email: "Email address must be a valid email address." });
      return;
    }
    setFieldErrors({});
    setSubmitting(true);
    try {
      await signIn.create({ strategy: "reset_password_email_code", identifier: email.trim() });
      setResetStep("code");
    } catch (err) {
      setFieldErrors(fieldErrorsFromClerkError(err));
    } finally {
      setSubmitting(false);
    }
  };

  const submitReset = async (e: FormEvent) => {
    e.preventDefault();
    if (!signInLoaded) return;
    const missing: FieldErrors = {};
    if (!code.trim()) missing.code = "Required";
    if (!password.trim()) missing.password = "Required";
    if (Object.keys(missing).length > 0) {
      setFieldErrors(missing);
      return;
    }
    if (password !== confirmPassword) {
      setFieldErrors({ confirmPassword: "Passwords don't match" });
      return;
    }
    setFieldErrors({});
    setSubmitting(true);
    try {
      const result = await signIn.attemptFirstFactor({
        strategy: "reset_password_email_code",
        code: code.trim(),
        password,
      });
      if (result.status === "complete") {
        await setActiveSignIn({ session: result.createdSessionId });
        navigate(from, { replace: true });
        return;
      }
      setFieldErrors({ form: "That code didn't work — try again." });
    } catch (err) {
      setFieldErrors(fieldErrorsFromClerkError(err));
    } finally {
      setSubmitting(false);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const missing: FieldErrors = {};
    if (mode === "signup" && !firstName.trim()) missing.firstName = "Required";
    if (!email.trim()) missing.email = "Required";
    if (!password.trim()) missing.password = "Required";
    if (Object.keys(missing).length > 0) {
      setFieldErrors(missing);
      return;
    }
    if (!EMAIL_PATTERN.test(email.trim())) {
      setFieldErrors({ email: "Email address must be a valid email address." });
      return;
    }
    setFieldErrors({});
    setSubmitting(true);
    try {
      if (mode === "login") await submitLogin();
      else await submitSignup();
    } catch (err) {
      setFieldErrors(fieldErrorsFromClerkError(err));
    } finally {
      setSubmitting(false);
    }
  };

  const submitVerification = async (e: FormEvent) => {
    e.preventDefault();
    if (!signUpLoaded) return;
    if (!code.trim()) {
      setFieldErrors({ code: "Required" });
      return;
    }
    setFieldErrors({});
    setSubmitting(true);
    try {
      const result = await signUp.attemptEmailAddressVerification({ code: code.trim() });
      if (result.status === "complete") {
        await setActiveSignUp({ session: result.createdSessionId });
        navigate(from, { replace: true });
        return;
      }
      setFieldErrors({ form: "That code didn't work — try again." });
    } catch (err) {
      setFieldErrors(fieldErrorsFromClerkError(err));
    } finally {
      setSubmitting(false);
    }
  };

  if (pendingVerification) {
    return (
      <PageShell>
        <Header />
        <PageContent>
          <NarrowColumn>
            <Card>
              <div className={styles.title}>Check your email</div>
              <div className={styles.subtitle}>
                We sent a code to {email.trim()} — enter it below to finish signing up.
              </div>
              <form className={styles.fieldStack} onSubmit={submitVerification} noValidate>
                <Input
                  label="Verification code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="123456"
                  error={fieldErrors.code}
                  autoFocus
                />
                {fieldErrors.form && <div className={styles.formError}>{fieldErrors.form}</div>}
                <div className={styles.buttonRow}>
                  <Button type="submit" size="lg" disabled={submitting} fullWidth>
                    {submitting ? "Verifying…" : "Verify email"}
                  </Button>
                </div>
              </form>
            </Card>
          </NarrowColumn>
        </PageContent>
      </PageShell>
    );
  }

  if (mode === "reset") {
    return (
      <PageShell>
        <Header />
        <PageContent>
          <NarrowColumn>
            <Card>
              {resetStep === "code" ? (
                <>
                  <div className={styles.title}>Reset your password</div>
                  <div className={styles.subtitle}>
                    We sent a code to {email.trim()} — enter it below along with your new password.
                  </div>
                  <form className={styles.fieldStack} onSubmit={submitReset} noValidate>
                    <Input
                      label="Verification code"
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      placeholder="123456"
                      error={fieldErrors.code}
                      autoFocus
                    />
                    <Input
                      label="New password"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      error={fieldErrors.password}
                    />
                    <Input
                      label="Confirm new password"
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="••••••••"
                      error={fieldErrors.confirmPassword}
                    />
                    {fieldErrors.form && <div className={styles.formError}>{fieldErrors.form}</div>}
                    <div className={styles.buttonRow}>
                      <Button type="submit" size="lg" disabled={submitting} fullWidth>
                        {submitting ? "…" : "Reset password"}
                      </Button>
                    </div>
                    <a
                      href="#"
                      className={styles.backLink}
                      onClick={(e) => {
                        e.preventDefault();
                        backToLogin();
                      }}
                    >
                      Back to log in
                    </a>
                  </form>
                </>
              ) : (
                <>
                  <div className={styles.title}>Reset your password</div>
                  <div className={styles.subtitle}>
                    Enter your email and we&rsquo;ll send you a code to reset it.
                  </div>
                  <form className={styles.fieldStack} onSubmit={requestReset} noValidate>
                    <Input
                      label="Email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@email.com"
                      error={fieldErrors.email}
                    />
                    <div className={styles.buttonRow}>
                      <Button type="submit" size="lg" disabled={submitting} fullWidth>
                        {submitting ? "…" : "Send reset code"}
                      </Button>
                    </div>
                    <a
                      href="#"
                      className={styles.backLink}
                      onClick={(e) => {
                        e.preventDefault();
                        backToLogin();
                      }}
                    >
                      Back to log in
                    </a>
                  </form>
                </>
              )}
            </Card>
          </NarrowColumn>
        </PageContent>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <Header />
      <PageContent>
        <NarrowColumn>
          <Card>
            {mockUsers.length > 0 && (
              <>
                <div className={styles.devUsers}>
                  <div className={styles.dividerText}>Sign in as (dev)</div>
                  <div className={styles.devUserRow}>
                    {mockUsers.map((user) => (
                      <div key={user.id} className={styles.devUserItem}>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          fullWidth
                          onClick={() => signInAsDevUser(user)}
                        >
                          {user.displayName}
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
                <div className={styles.divider}>
                  <span className={styles.dividerLine} />
                  <span className={styles.dividerText}>or</span>
                  <span className={styles.dividerLine} />
                </div>
              </>
            )}
            <button type="button" className={styles.googleButton} onClick={signInWithGoogle}>
              <GoogleIcon />
              Continue with Google
            </button>
            <div className={styles.divider}>
              <span className={styles.dividerLine} />
              <span className={styles.dividerText}>or</span>
              <span className={styles.dividerLine} />
            </div>
            <div className={styles.tabs} role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={mode === "login"}
                className={cx(styles.tab, mode === "login" && styles.tabActive)}
                onClick={() => switchMode("login")}
              >
                Log in
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === "signup"}
                className={cx(styles.tab, mode === "signup" && styles.tabActive)}
                onClick={() => switchMode("signup")}
              >
                Sign up
              </button>
            </div>
            <form className={styles.fieldStack} onSubmit={submit} noValidate>
              {mode === "signup" && (
                <Input
                  label="First name"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="Your first name"
                  error={fieldErrors.firstName}
                />
              )}
              <Input
                label="Email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@email.com"
                error={fieldErrors.email}
              />
              <Input
                label="Password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                error={fieldErrors.password}
              />
              {fieldErrors.form && <div className={styles.formError}>{fieldErrors.form}</div>}
              {mode === "login" && (
                <a
                  href="#"
                  className={styles.forgotLink}
                  onClick={(e) => {
                    e.preventDefault();
                    showReset();
                  }}
                >
                  Forgot password?
                </a>
              )}
              <div className={styles.buttonRow}>
                <Button type="submit" size="lg" disabled={submitting} fullWidth>
                  {submitting ? "…" : mode === "login" ? "Log in" : "Create account"}
                </Button>
              </div>
            </form>
          </Card>
        </NarrowColumn>
      </PageContent>
    </PageShell>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84c-.21 1.13-.85 2.09-1.81 2.73v2.26h2.92c1.7-1.57 2.69-3.88 2.69-6.63z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.71H.9v2.33C2.38 15.98 5.44 18 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.71c-.18-.54-.28-1.11-.28-1.71s.1-1.17.28-1.71V4.96H.9C.33 6.09 0 7.51 0 9s.33 2.91.9 4.04l3.07-2.33z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0 5.44 0 2.38 2.02.9 4.96l3.07 2.33C4.68 5.16 6.66 3.58 9 3.58z"
      />
    </svg>
  );
}
