import { currentUser } from "@clerk/nextjs/server";

export interface IClerkIdentity {
    clerkUserId: string;
    email: string | undefined;
    emailVerified: boolean;
    name: string | undefined;
}

export async function currentClerkIdentity(): Promise<
    IClerkIdentity | undefined
> {
    const user = await currentUser();
    if (!user) return undefined;

    const primaryEmail = user.primaryEmailAddress;
    return {
        clerkUserId: user.id,
        email: primaryEmail?.emailAddress,
        emailVerified: primaryEmail?.verification?.status === "verified",
        name: user.fullName ?? undefined,
    };
}
