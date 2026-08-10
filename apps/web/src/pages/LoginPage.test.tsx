import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LoginPage } from "./LoginPage";

const signInCreateMock = vi.fn();
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
vi.mock("@clerk/react", () => ({
  useAuth: () => ({ isLoaded: true, isSignedIn }),
  Show: ({ when, children }: { when: "signed-in" | "signed-out"; children: ReactNode }) =>
    when === "signed-out" ? <>{children}</> : null,
  useUser: () => ({ isLoaded: true, isSignedIn: false, user: null }),
  useClerk: () => ({ signOut: vi.fn() }),
}));

vi.mock("@clerk/react/legacy", () => ({
  useSignIn: () => ({
    isLoaded: true,
    signIn: { create: signInCreateMock, authenticateWithRedirect: authenticateWithRedirectMock },
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
}));

function renderPage() {
  return render(
    <MemoryRouter
      initialEntries={["/login"]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<div>Home</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  isSignedIn = false;
  for (const mock of [
    signInCreateMock,
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

  it("requires email and password before submitting a login", async () => {
    renderPage();

    await userEvent.click(screen.getByRole("button", { name: "Log in" }));

    expect(screen.getByText("Required")).toBeInTheDocument();
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
    it("requires a name in addition to email and password", async () => {
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
      await userEvent.type(screen.getByLabelText("Name"), "Alex");
      await userEvent.type(screen.getByLabelText("Email"), "alex@example.com");
      await userEvent.type(screen.getByLabelText("Password"), "correct-password");
      await userEvent.click(screen.getByRole("button", { name: "Create account" }));

      expect(signUpCreateMock).toHaveBeenCalledWith({
        emailAddress: "alex@example.com",
        password: "correct-password",
        unsafeMetadata: { displayName: "Alex" },
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
      await userEvent.type(screen.getByLabelText("Name"), "Alex");
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
});
