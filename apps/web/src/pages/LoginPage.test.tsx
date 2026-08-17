import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LoginPage } from "./LoginPage";

const signInCreateMock = vi.fn();
const attemptFirstFactorMock = vi.fn();
const setActiveSignInMock = vi.fn();
const authenticateWithRedirectMock = vi.fn();
const signUpCreateMock = vi.fn();
const prepareEmailAddressVerificationMock = vi.fn();
const attemptEmailAddressVerificationMock = vi.fn();
const setActiveSignUpMock = vi.fn();

let isSignedIn = false;

// Header (always rendered) pulls SignedIn/SignedOut/useUser/useClerk from
// the same module — this test only exercises the sign-in/sign-up flow, not
// the header's account indicator, so those get simple stand-ins.
vi.mock("../auth", () => ({
  useAuth: () => ({ isLoaded: true, isSignedIn }),
  Show: ({ when, children }: { when: "signed-in" | "signed-out"; children: ReactNode }) =>
    when === "signed-out" ? <>{children}</> : null,
  useUser: () => ({ isLoaded: true, isSignedIn: false, user: null }),
  useClerk: () => ({ signOut: vi.fn() }),
  useSignIn: () => ({
    isLoaded: true,
    signIn: {
      create: signInCreateMock,
      attemptFirstFactor: attemptFirstFactorMock,
      authenticateWithRedirect: authenticateWithRedirectMock,
    },
    setActive: setActiveSignInMock,
  }),
  useSignUp: () => ({
    isLoaded: true,
    signUp: {
      create: signUpCreateMock,
      prepareEmailAddressVerification: prepareEmailAddressVerificationMock,
      attemptEmailAddressVerification: attemptEmailAddressVerificationMock,
    },
    setActive: setActiveSignUpMock,
  }),
  mockUsers: [],
  quickSignIn: null,
}));

function renderPage(
  initialEntries: Parameters<typeof MemoryRouter>[0]["initialEntries"] = ["/login"],
) {
  return render(
    <MemoryRouter
      initialEntries={initialEntries}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<div>Home</div>} />
        <Route path="/ABCDE" element={<div>The lobby</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  isSignedIn = false;
  for (const mock of [
    signInCreateMock,
    attemptFirstFactorMock,
    setActiveSignInMock,
    authenticateWithRedirectMock,
    signUpCreateMock,
    prepareEmailAddressVerificationMock,
    attemptEmailAddressVerificationMock,
    setActiveSignUpMock,
  ]) {
    mock.mockReset();
  }
});

describe("LoginPage", () => {
  it("redirects a signed-in visitor straight home", () => {
    isSignedIn = true;
    renderPage();

    expect(screen.getByText("Home")).toBeInTheDocument();
  });

  it("returns to the page RequireAuth redirected from, once signed in", async () => {
    signInCreateMock.mockResolvedValue({ status: "complete", createdSessionId: "sess_1" });
    renderPage([{ pathname: "/login", state: { from: { pathname: "/ABCDE" } } }]);

    await userEvent.type(screen.getByLabelText("Email"), "alex@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "correct-password");
    await userEvent.click(screen.getByRole("button", { name: "Log in" }));

    expect(await screen.findByText("The lobby")).toBeInTheDocument();
  });

  it("requires email and password before submitting a login, on their own fields", async () => {
    renderPage();

    await userEvent.click(screen.getByRole("button", { name: "Log in" }));

    expect(screen.getAllByText("Required")).toHaveLength(2);
    expect(signInCreateMock).not.toHaveBeenCalled();
  });

  it("only flags the empty field as Required when the other is filled in", async () => {
    renderPage();

    const emailField = screen.getByLabelText("Email").closest("label");
    const passwordField = screen.getByLabelText("Password").closest("label");
    await userEvent.type(screen.getByLabelText("Email"), "alex@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Log in" }));

    expect(passwordField).toHaveTextContent("Required");
    expect(emailField).not.toHaveTextContent("Required");
    expect(signInCreateMock).not.toHaveBeenCalled();
  });

  it("logs in and activates the session on a complete sign-in", async () => {
    signInCreateMock.mockResolvedValue({ status: "complete", createdSessionId: "sess_1" });
    renderPage();

    await userEvent.type(screen.getByLabelText("Email"), "alex@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "correct-password");
    await userEvent.click(screen.getByRole("button", { name: "Log in" }));

    expect(signInCreateMock).toHaveBeenCalledWith({
      strategy: "password",
      identifier: "alex@example.com",
      password: "correct-password",
    });
    expect(setActiveSignInMock).toHaveBeenCalledWith({ session: "sess_1" });
    expect(await screen.findByText("Home")).toBeInTheDocument();
  });

  it("shows the Clerk error message when login fails", async () => {
    signInCreateMock.mockRejectedValue({ errors: [{ message: "Incorrect password" }] });
    renderPage();

    await userEvent.type(screen.getByLabelText("Email"), "alex@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "wrong");
    await userEvent.click(screen.getByRole("button", { name: "Log in" }));

    expect(await screen.findByText("Incorrect password")).toBeInTheDocument();
  });

  it("highlights the email field when the account doesn't exist", async () => {
    signInCreateMock.mockRejectedValue({
      errors: [{ message: "Couldn't find your account", meta: { paramName: "identifier" } }],
    });
    renderPage();

    const emailField = screen.getByLabelText("Email").closest("label");
    await userEvent.type(screen.getByLabelText("Email"), "nobody@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "whatever");
    await userEvent.click(screen.getByRole("button", { name: "Log in" }));

    const message = await screen.findByText("Couldn't find your account");
    expect(emailField).toContainElement(message);
  });

  it("highlights the password field when the password is wrong", async () => {
    signInCreateMock.mockRejectedValue({
      errors: [
        {
          message: "Password is incorrect. Try again, or use another method.",
          meta: { paramName: "password" },
        },
      ],
    });
    renderPage();

    const passwordField = screen.getByLabelText("Password").closest("label");
    await userEvent.type(screen.getByLabelText("Email"), "alex@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "wrong-password");
    await userEvent.click(screen.getByRole("button", { name: "Log in" }));

    const message = await screen.findByText(
      "Password is incorrect. Try again, or use another method.",
    );
    expect(passwordField).toContainElement(message);
  });

  it("catches a malformed email client-side, without calling Clerk", async () => {
    renderPage();

    await userEvent.type(screen.getByLabelText("Email"), "not-an-email");
    await userEvent.type(screen.getByLabelText("Password"), "correct-password");
    await userEvent.click(screen.getByRole("button", { name: "Log in" }));

    expect(screen.getByText("Email address must be a valid email address.")).toBeInTheDocument();
    expect(signInCreateMock).not.toHaveBeenCalled();
  });

  it("starts the Google redirect flow when clicked", async () => {
    renderPage();

    await userEvent.click(screen.getByRole("button", { name: "Continue with Google" }));

    expect(authenticateWithRedirectMock).toHaveBeenCalledWith({
      strategy: "oauth_google",
      redirectUrl: "/sso-callback",
      redirectUrlComplete: "/",
    });
  });

  describe("sign-up tab", () => {
    it("requires a first name in addition to email and password", async () => {
      renderPage();
      await userEvent.click(screen.getByRole("tab", { name: "Sign up" }));

      await userEvent.type(screen.getByLabelText("Email"), "alex@example.com");
      await userEvent.type(screen.getByLabelText("Password"), "correct-password");
      await userEvent.click(screen.getByRole("button", { name: "Create account" }));

      expect(screen.getByText("Required")).toBeInTheDocument();
      expect(signUpCreateMock).not.toHaveBeenCalled();
    });

    it("moves to email verification when the sign-up isn't complete yet", async () => {
      signUpCreateMock.mockResolvedValue({ status: "missing_requirements" });
      prepareEmailAddressVerificationMock.mockResolvedValue({});
      renderPage();

      await userEvent.click(screen.getByRole("tab", { name: "Sign up" }));
      await userEvent.type(screen.getByLabelText("First name"), "Alex");
      await userEvent.type(screen.getByLabelText("Email"), "alex@example.com");
      await userEvent.type(screen.getByLabelText("Password"), "correct-password");
      await userEvent.click(screen.getByRole("button", { name: "Create account" }));

      expect(signUpCreateMock).toHaveBeenCalledWith({
        emailAddress: "alex@example.com",
        password: "correct-password",
        firstName: "Alex",
      });
      expect(prepareEmailAddressVerificationMock).toHaveBeenCalledWith({ strategy: "email_code" });
      expect(await screen.findByText("Check your email")).toBeInTheDocument();
    });

    it("completes sign-up once the verification code is accepted", async () => {
      signUpCreateMock.mockResolvedValue({ status: "missing_requirements" });
      prepareEmailAddressVerificationMock.mockResolvedValue({});
      attemptEmailAddressVerificationMock.mockResolvedValue({
        status: "complete",
        createdSessionId: "sess_2",
      });
      renderPage();

      await userEvent.click(screen.getByRole("tab", { name: "Sign up" }));
      await userEvent.type(screen.getByLabelText("First name"), "Alex");
      await userEvent.type(screen.getByLabelText("Email"), "alex@example.com");
      await userEvent.type(screen.getByLabelText("Password"), "correct-password");
      await userEvent.click(screen.getByRole("button", { name: "Create account" }));

      await userEvent.type(await screen.findByLabelText("Verification code"), "123456");
      await userEvent.click(screen.getByRole("button", { name: "Verify email" }));

      expect(attemptEmailAddressVerificationMock).toHaveBeenCalledWith({ code: "123456" });
      expect(setActiveSignUpMock).toHaveBeenCalledWith({ session: "sess_2" });
      expect(await screen.findByText("Home")).toBeInTheDocument();
    });
  });

  describe("password reset", () => {
    it("requires an email before requesting a reset code", async () => {
      renderPage();
      await userEvent.click(screen.getByRole("link", { name: "Forgot password?" }));

      await userEvent.click(screen.getByRole("button", { name: "Send reset code" }));

      expect(screen.getByText("Required")).toBeInTheDocument();
      expect(signInCreateMock).not.toHaveBeenCalled();
    });

    it("requests a reset code, then resets the password and signs the visitor in", async () => {
      signInCreateMock.mockResolvedValue({});
      attemptFirstFactorMock.mockResolvedValue({ status: "complete", createdSessionId: "sess_3" });
      renderPage();

      await userEvent.click(screen.getByRole("link", { name: "Forgot password?" }));
      await userEvent.type(screen.getByLabelText("Email"), "alex@example.com");
      await userEvent.click(screen.getByRole("button", { name: "Send reset code" }));

      expect(signInCreateMock).toHaveBeenCalledWith({
        strategy: "reset_password_email_code",
        identifier: "alex@example.com",
      });
      expect(await screen.findByLabelText("Verification code")).toBeInTheDocument();

      await userEvent.type(screen.getByLabelText("Verification code"), "123456");
      await userEvent.type(screen.getByLabelText("New password"), "new-password");
      await userEvent.type(screen.getByLabelText("Confirm new password"), "new-password");
      await userEvent.click(screen.getByRole("button", { name: "Reset password" }));

      expect(attemptFirstFactorMock).toHaveBeenCalledWith({
        strategy: "reset_password_email_code",
        code: "123456",
        password: "new-password",
      });
      expect(setActiveSignInMock).toHaveBeenCalledWith({ session: "sess_3" });
      expect(await screen.findByText("Home")).toBeInTheDocument();
    });

    it("highlights the code field, not confirm password, when the code is wrong", async () => {
      signInCreateMock.mockResolvedValue({});
      attemptFirstFactorMock.mockRejectedValue({
        errors: [{ message: "Incorrect code", meta: { paramName: "code" } }],
      });
      renderPage();

      await userEvent.click(screen.getByRole("link", { name: "Forgot password?" }));
      await userEvent.type(screen.getByLabelText("Email"), "alex@example.com");
      await userEvent.click(screen.getByRole("button", { name: "Send reset code" }));

      const codeField = (await screen.findByLabelText("Verification code")).closest("label");
      await userEvent.type(screen.getByLabelText("Verification code"), "000000");
      await userEvent.type(screen.getByLabelText("New password"), "new-password");
      await userEvent.type(screen.getByLabelText("Confirm new password"), "new-password");
      await userEvent.click(screen.getByRole("button", { name: "Reset password" }));

      const message = await screen.findByText("Incorrect code");
      expect(codeField).toContainElement(message);
    });

    it("rejects a mismatched password confirmation without calling Clerk", async () => {
      signInCreateMock.mockResolvedValue({});
      renderPage();

      await userEvent.click(screen.getByRole("link", { name: "Forgot password?" }));
      await userEvent.type(screen.getByLabelText("Email"), "alex@example.com");
      await userEvent.click(screen.getByRole("button", { name: "Send reset code" }));

      await userEvent.type(await screen.findByLabelText("Verification code"), "123456");
      await userEvent.type(screen.getByLabelText("New password"), "new-password");
      await userEvent.type(screen.getByLabelText("Confirm new password"), "different");
      await userEvent.click(screen.getByRole("button", { name: "Reset password" }));

      expect(screen.getByText("Passwords don't match")).toBeInTheDocument();
      expect(attemptFirstFactorMock).not.toHaveBeenCalled();
    });

    it("returns to log in from the reset form via the back link", async () => {
      renderPage();

      await userEvent.click(screen.getByRole("link", { name: "Forgot password?" }));
      expect(screen.getByRole("button", { name: "Send reset code" })).toBeInTheDocument();

      await userEvent.click(screen.getByRole("link", { name: "Back to log in" }));

      expect(screen.getByRole("button", { name: "Log in" })).toBeInTheDocument();
    });
  });
});
