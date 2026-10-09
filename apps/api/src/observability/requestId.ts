import { randomUUID } from "node:crypto";

const REQUEST_ID_HEADER = "x-request-id";
const CORRELATION_ID_HEADER = "x-correlation-id";
const SAFE_REQUEST_ID = /^[a-zA-Z0-9._:-]{8,128}$/;

export function requestIdFromHeaders(headers: Headers): string {
    const inbound =
        headers.get(REQUEST_ID_HEADER) ?? headers.get(CORRELATION_ID_HEADER);
    return isSafeRequestId(inbound) ? inbound : randomUUID();
}

function isSafeRequestId(value: string | null): value is string {
    return value !== null && SAFE_REQUEST_ID.test(value);
}
