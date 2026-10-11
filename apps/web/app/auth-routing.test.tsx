import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    signOut: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/server/auth/mode", () => ({ isDevAuthEnabled: () => false }));
vi.mock("@clerk/nextjs", () => ({
    SignIn: ({ forceRedirectUrl }: { forceRedirectUrl: string }) => (
        <p>sign-in destination: {forceRedirectUrl}</p>
    ),
    SignUp: ({ forceRedirectUrl }: { forceRedirectUrl: string }) => (
        <p>sign-up destination: {forceRedirectUrl}</p>
    ),
    useClerk: () => ({ signOut: mocks.signOut }),
}));

import SignInPage from "./sign-in/[[...sign-in]]/page";
import SignUpPage from "./sign-up/[[...sign-up]]/page";
import { AccessDeniedSignOutButton } from "./access-denied/sign-out-button";

describe("Clerk component redirect configuration (mocked components)", () => {
    afterEach(cleanup);

    it("forces both successful sign-in and sign-up to the protected dashboard", () => {
        render(
            <>
                <SignInPage />
                <SignUpPage />
            </>,
        );
        expect(
            screen.getByText("sign-in destination: /dashboard"),
        ).toBeInTheDocument();
        expect(
            screen.getByText("sign-up destination: /dashboard"),
        ).toBeInTheDocument();
    });

    it("returns a rejected account to the marketing page on sign-out", () => {
        render(<AccessDeniedSignOutButton />);
        fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
        expect(mocks.signOut).toHaveBeenCalledWith({ redirectUrl: "/" });
    });
});
