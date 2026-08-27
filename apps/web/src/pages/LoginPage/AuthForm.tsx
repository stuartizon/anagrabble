import { useState } from "react";
import type { Dispatch, FormEvent, SetStateAction } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useSignIn, useSignUp, mockUsers, quickSignIn } from "../../auth";
import { Input } from "../../components/Input";
import { Button } from "../../components/Button";
import { cx } from "../../utils/cx";
import styles from "./LoginPage.module.css";
import { FormError } from "./FormError";
import { GoogleIcon } from "./GoogleIcon";
import { EMAIL_PATTERN, fieldErrorsFromClerkError } from "./clerkErrors";
import { useRedirectTarget } from "./useRedirectTarget";
import type { FieldErrors, Mode } from "./types";

const OAUTH_REDIRECT_URL = "/sso-callback";

export function AuthForm({
  mode,
  switchMode,
  showReset,
  firstName,
  setFirstName,
  email,
  setEmail,
  password,
  setPassword,
  fieldErrors,
  setFieldErrors,
  setPendingVerification,
}: {
  mode: "login" | "signup";
  switchMode: (next: Mode) => void;
  showReset: () => void;
  firstName: string;
  setFirstName: Dispatch<SetStateAction<string>>;
  email: string;
  setEmail: Dispatch<SetStateAction<string>>;
  password: string;
  setPassword: Dispatch<SetStateAction<string>>;
  fieldErrors: FieldErrors;
  setFieldErrors: Dispatch<SetStateAction<FieldErrors>>;
  setPendingVerification: Dispatch<SetStateAction<boolean>>;
}) {
  const navigate = useNavigate();
  const from = useRedirectTarget();
  const { isLoaded: signInLoaded, signIn, setActive: setActiveSignIn } = useSignIn();
  const { isLoaded: signUpLoaded, signUp, setActive: setActiveSignUp } = useSignUp();
  const [submitting, setSubmitting] = useState(false);

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

  const handleSubmit = async (e: FormEvent) => {
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

  return (
    <>
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
      <form className={styles.fieldStack} onSubmit={handleSubmit} noValidate>
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
        <FormError message={fieldErrors.form} />
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
      {mode === "signup" && (
        <p className={styles.consentText}>
          By creating an account, you agree to our <Link to="/terms">Terms of service</Link> and{" "}
          <Link to="/privacy">Privacy policy</Link>.
        </p>
      )}
    </>
  );
}
