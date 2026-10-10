import { ApiBadRequestError } from "../errors.js";

export const DEFAULT_MCP_PAGE_SIZE = 50;
export const MAX_MCP_PAGE_SIZE = 100;

export interface IMcpPageCursor {
    createdAt: string;
    id: string;
}

interface ICursorEnvelope extends IMcpPageCursor {
    version: 1;
    scope: string;
}

export function boundedMcpPageSize(value: number | undefined): number {
    const limit = value ?? DEFAULT_MCP_PAGE_SIZE;
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_MCP_PAGE_SIZE) {
        throw new ApiBadRequestError(
            `limit must be an integer from 1 to ${MAX_MCP_PAGE_SIZE}.`,
        );
    }
    return limit;
}

export function encodeMcpPageCursor(
    scope: string,
    cursor: IMcpPageCursor,
): string {
    const envelope: ICursorEnvelope = { version: 1, scope, ...cursor };
    return Buffer.from(JSON.stringify(envelope)).toString("base64url");
}

export function decodeMcpPageCursor(
    encoded: string | undefined,
    expectedScope: string,
): IMcpPageCursor | undefined {
    if (encoded === undefined) return undefined;
    try {
        const parsed = JSON.parse(
            Buffer.from(encoded, "base64url").toString("utf8"),
        ) as Partial<ICursorEnvelope>;
        if (
            parsed.version !== 1 ||
            parsed.scope !== expectedScope ||
            typeof parsed.createdAt !== "string" ||
            Number.isNaN(Date.parse(parsed.createdAt)) ||
            typeof parsed.id !== "string" ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
                parsed.id,
            )
        ) {
            throw new Error("invalid cursor envelope");
        }
        return {
            createdAt: new Date(parsed.createdAt).toISOString(),
            id: parsed.id,
        };
    } catch {
        throw new ApiBadRequestError(
            "Invalid page cursor. Restart pagination without a cursor.",
        );
    }
}

export function pageCursorFromRow(
    scope: string,
    row: { createdAt: Date | string; id: string },
): string {
    return encodeMcpPageCursor(scope, {
        createdAt:
            row.createdAt instanceof Date
                ? row.createdAt.toISOString()
                : new Date(row.createdAt).toISOString(),
        id: row.id,
    });
}
