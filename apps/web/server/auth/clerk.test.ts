import { beforeEach, describe, expect, it, vi } from "vitest";
import { currentClerkIdentity } from "./clerk";

const clerkMock = vi.hoisted(() => ({
    currentUser: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({
    currentUser: clerkMock.currentUser,
}));

describe("currentClerkIdentity", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("uses the current Clerk user as the server identity", async () => {
        clerkMock.currentUser.mockResolvedValue({
            id: "clerk-1",
            fullName: "Alice",
            primaryEmailAddress: {
                emailAddress: "alice@example.com",
                verification: { status: "verified" },
            },
        });

        await expect(currentClerkIdentity()).resolves.toEqual({
            clerkUserId: "clerk-1",
            email: "alice@example.com",
            emailVerified: true,
            name: "Alice",
        });
        expect(clerkMock.currentUser).toHaveBeenCalledTimes(1);
    });

    it("returns undefined when there is no Clerk user", async () => {
        clerkMock.currentUser.mockResolvedValue(null);

        await expect(currentClerkIdentity()).resolves.toBeUndefined();
    });
});
