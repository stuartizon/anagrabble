import type { FieldErrors, FieldKey } from "./types";

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

export function fieldErrorsFromClerkError(err: unknown): FieldErrors {
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
