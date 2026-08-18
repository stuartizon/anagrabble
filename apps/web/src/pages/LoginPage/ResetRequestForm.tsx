import { useState } from "react";
import type { Dispatch, FormEvent, SetStateAction } from "react";
import { useSignIn } from "../../auth";
import { Input } from "../../components/Input";
import { Button } from "../../components/Button";
import styles from "./LoginPage.module.css";
import { BackToLoginLink } from "./BackToLoginLink";
import { EMAIL_PATTERN, fieldErrorsFromClerkError } from "./clerkErrors";
import type { FieldErrors, ResetStep } from "./types";

export function ResetRequestForm({
  email,
  setEmail,
  fieldErrors,
  setFieldErrors,
  setResetStep,
  onBack,
}: {
  email: string;
  setEmail: Dispatch<SetStateAction<string>>;
  fieldErrors: FieldErrors;
  setFieldErrors: Dispatch<SetStateAction<FieldErrors>>;
  setResetStep: Dispatch<SetStateAction<ResetStep>>;
  onBack: () => void;
}) {
  const { isLoaded: signInLoaded, signIn } = useSignIn();
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
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

  return (
    <>
      <div className={styles.title}>Reset your password</div>
      <div className={styles.subtitle}>
        Enter your email and we&rsquo;ll send you a code to reset it.
      </div>
      <form className={styles.fieldStack} onSubmit={handleSubmit} noValidate>
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
        <BackToLoginLink onBack={onBack} />
      </form>
    </>
  );
}
