import { describe, expect, it } from "vitest";
import { REDACTED, redactSecrets, redactedErrorDetail } from "./index.js";

describe("redactSecrets", () => {
    it.each([
        ["Authorization: Bearer abc.def-123456", "abc.def-123456"],
        ['{"authorization":"Bearer tok_1234567890"}', "tok_1234567890"],
        ["headers: { Authorization: 'Basic dXNlcjpwYXNz' }", "dXNlcjpwYXNz"],
        ["x-api-key: key-live-998877", "key-live-998877"],
        ['{"apiKey":"plain-secret-value"}', "plain-secret-value"],
        ["api_key=qwertyuiop", "qwertyuiop"],
        [
            "GET https://generativelanguage.googleapis.com/v1/models?key=AIzaSyA1234567890abcdefghijk",
            "AIzaSyA1234567890abcdefghijk",
        ],
        [
            "Incorrect API key provided: sk-proj-abcDEF1234567890",
            "sk-proj-abcDEF1234567890",
        ],
        [
            "OpenRouter rejected sk-or-v1-0123456789abcdef",
            "sk-or-v1-0123456789abcdef",
        ],
        ["gateway token vck_ABCDEFGH12345678 invalid", "vck_ABCDEFGH12345678"],
        [
            "xAI rejected xai-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcd",
            "xai-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcd",
        ],
        [
            "upstream said bearer eyJhbGciOiJIUzI1NiJ9.payload",
            "eyJhbGciOiJIUzI1NiJ9",
        ],
    ])("removes the credential from %s", (input, secret) => {
        const output = redactSecrets(input);
        expect(output).not.toContain(secret);
        expect(output).toContain(REDACTED);
    });

    it("leaves ordinary error text alone", () => {
        const text =
            "429 Too Many Requests: rate limit exceeded for model gpt-4o (task-skip)";
        expect(redactSecrets(text)).toBe(text);
    });

    it("keeps xAI model ids that share the key prefix", () => {
        const text = "model xai-grok-3-mini returned 500 (xai-grok-4-fast)";
        expect(redactSecrets(text)).toBe(text);
    });
});

describe("redactedErrorDetail", () => {
    it("redacts the message, stack, and cause chain", () => {
        const cause = new Error(
            "request had Authorization: Bearer inner-secret-123",
        );
        const err = Object.assign(
            new Error("provider failed for sk-live-abcdef123456"),
            { cause },
        );

        const detail = redactedErrorDetail(err);

        expect(detail).toContain("provider failed");
        expect(detail).toContain("Caused by:");
        expect(detail).not.toContain("sk-live-abcdef123456");
        expect(detail).not.toContain("inner-secret-123");
    });

    it("stringifies non-errors", () => {
        expect(redactedErrorDetail("x-api-key=zzz999")).toBe(
            `x-api-key=${REDACTED}`,
        );
    });
});
