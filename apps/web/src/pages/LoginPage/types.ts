export type Mode = "login" | "signup" | "reset";
export type ResetStep = "request" | "code";

// Which field an error belongs to, "form" being a catch-all banner for
// errors that aren't about any single field (e.g. an OAuth redirect
// failure, or a Clerk error code we don't have a mapping for).
export type FieldKey = "firstName" | "email" | "password" | "confirmPassword" | "code" | "form";
export type FieldErrors = Partial<Record<FieldKey, string>>;
