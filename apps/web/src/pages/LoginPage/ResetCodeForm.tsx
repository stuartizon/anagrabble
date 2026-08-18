import { useState } from "react";
import type { Dispatch, FormEvent, SetStateAction } from "react";
import { useNavigate } from "react-router-dom";
import { useSignIn } from "../../auth";
import { Input } from "../../components/Input";
import { Button } from "../../components/Button";
import styles from "./LoginPage.module.css";
import { FormError } from "./FormError";
import { BackToLoginLink } from "./BackToLoginLink";
import { fieldErrorsFromClerkError } from "./clerkErrors";
import { useRedirectTarget } from "./useRedirectTarget";
import type { FieldErrors } from "./types";

export function ResetCodeForm({
  email,
  code,
  setCode,
  password,
  setPassword,
  confirmPassword,
  setConfirmPassword,
  fieldErrors,
  setFieldErrors,
  onBack,
}: {
  email: string;
  code: string;
  setCode: Dispatch<SetStateAction<string>>;
  password: string;
  setPassword: Dispatch<SetStateAction<string>>;
  confirmPassword: string;
  setConfirmPassword: Dispatch<SetStateAction<string>>;
  fieldErrors: FieldErrors;
  setFieldErrors: Dispatch<SetStateAction<FieldErrors>>;
  onBack: () => void;
}) {
  const navigate = useNavigate();
  const from = useRedirectTarget();
  const { isLoaded: signInLoaded, signIn, setActive: setActiveSignIn } = useSignIn();
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
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

  return (
    <>
      <div className={styles.title}>Reset your password</div>
      <div className={styles.subtitle}>
        We sent a code to {email.trim()} — enter it below along with your new password.
      </div>
      <form className={styles.fieldStack} onSubmit={handleSubmit} noValidate>
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
        <FormError message={fieldErrors.form} />
        <div className={styles.buttonRow}>
          <Button type="submit" size="lg" disabled={submitting} fullWidth>
            {submitting ? "…" : "Reset password"}
          </Button>
        </div>
        <BackToLoginLink onBack={onBack} />
      </form>
    </>
  );
}
