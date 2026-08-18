import { useState } from "react";
import type { Dispatch, FormEvent, SetStateAction } from "react";
import { useNavigate } from "react-router-dom";
import { useSignUp } from "../../auth";
import { Input } from "../../components/Input";
import { Button } from "../../components/Button";
import styles from "./LoginPage.module.css";
import { FormError } from "./FormError";
import { fieldErrorsFromClerkError } from "./clerkErrors";
import { useRedirectTarget } from "./useRedirectTarget";
import type { FieldErrors } from "./types";

export function VerificationForm({
  email,
  code,
  setCode,
  fieldErrors,
  setFieldErrors,
}: {
  email: string;
  code: string;
  setCode: Dispatch<SetStateAction<string>>;
  fieldErrors: FieldErrors;
  setFieldErrors: Dispatch<SetStateAction<FieldErrors>>;
}) {
  const navigate = useNavigate();
  const from = useRedirectTarget();
  const { isLoaded: signUpLoaded, signUp, setActive: setActiveSignUp } = useSignUp();
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
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

  return (
    <>
      <div className={styles.title}>Check your email</div>
      <div className={styles.subtitle}>
        We sent a code to {email.trim()} — enter it below to finish signing up.
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
        <FormError message={fieldErrors.form} />
        <div className={styles.buttonRow}>
          <Button type="submit" size="lg" disabled={submitting} fullWidth>
            {submitting ? "Verifying…" : "Verify email"}
          </Button>
        </div>
      </form>
    </>
  );
}
