import { NextResponse } from "next/server";
import { ForbiddenError, UnauthorizedError } from "./session";

export function authErrorResponse(err: unknown): Response | undefined {
    if (err instanceof ForbiddenError) {
        return NextResponse.json(
            { error: err.message },
            { status: err.statusCode },
        );
    }
    if (err instanceof UnauthorizedError) {
        return NextResponse.json(
            { error: err.message },
            { status: err.statusCode },
        );
    }
    return undefined;
}
