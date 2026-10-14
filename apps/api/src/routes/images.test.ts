import { describe, expect, it } from "vitest";
import { mediaBytesResponse } from "./images.js";

const bytes = new TextEncoder().encode("abcdefghij");

describe("authorized media byte responses", () => {
    it.each([
        [null, 200, "abcdefghij", null],
        ["bytes=2-5", 206, "cdef", "bytes 2-5/10"],
        ["bytes=7-", 206, "hij", "bytes 7-9/10"],
        ["bytes=-3", 206, "hij", "bytes 7-9/10"],
        ["bytes=7-99", 206, "hij", "bytes 7-9/10"],
        ["bytes=10-", 416, "", "bytes */10"],
        ["bytes=5-2", 416, "", "bytes */10"],
        ["bytes=-0", 416, "", "bytes */10"],
        ["bytes=0-1,5-6", 200, "abcdefghij", null],
    ])("handles %s", async (range, status, body, contentRange) => {
        const response = mediaBytesResponse(bytes, "audio/wav", range);
        expect(response.status).toBe(status);
        expect(response.headers.get("content-length")).toBe(
            String(body.length),
        );
        expect(response.headers.get("content-range")).toBe(contentRange);
        expect(response.headers.get("accept-ranges")).toBe("bytes");
        await expect(response.text()).resolves.toBe(body);
    });
});
