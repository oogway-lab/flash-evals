import { describe, expect, it } from "vitest";
import { mediaBytesMatchType } from "./mediaSniff.js";

function bytes(...parts: Array<string | number[]>): Uint8Array {
    const out: number[] = [];
    for (const part of parts) {
        if (typeof part === "string") {
            for (const char of part) out.push(char.charCodeAt(0));
        } else {
            out.push(...part);
        }
    }
    return Uint8Array.from(out);
}

const SAMPLES: Record<string, Uint8Array> = {
    "image/png": bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    "image/jpeg": bytes([0xff, 0xd8, 0xff, 0xe0]),
    "image/gif": bytes("GIF89a"),
    "image/webp": bytes("RIFF", [0, 0, 0, 0], "WEBPVP8 "),
    "audio/mpeg": bytes("ID3", [4, 0, 0]),
    "audio/mp3": bytes([0xff, 0xfb, 0x90, 0x64]),
    "audio/mp4": bytes([0, 0, 0, 0x20], "ftypM4A "),
    "audio/aac": bytes([0xff, 0xf1, 0x50, 0x80]),
    "audio/wav": bytes("RIFF", [0, 0, 0, 0], "WAVEfmt "),
    "audio/x-wav": bytes("RIFF", [0, 0, 0, 0], "WAVEfmt "),
    "audio/webm": bytes([0x1a, 0x45, 0xdf, 0xa3, 0x9f]),
    "audio/ogg": bytes("OggS", [0]),
    "audio/flac": bytes("fLaC", [0]),
};

describe("mediaBytesMatchType", () => {
    it.each(Object.entries(SAMPLES))(
        "accepts a real %s signature",
        (mimeType, sample) => {
            expect(mediaBytesMatchType(sample, mimeType)).toBe(true);
        },
    );

    it("rejects content that does not match the declared type", () => {
        expect(mediaBytesMatchType(SAMPLES["image/png"]!, "image/jpeg")).toBe(
            false,
        );
        expect(mediaBytesMatchType(SAMPLES["audio/wav"]!, "image/webp")).toBe(
            false,
        );
        expect(mediaBytesMatchType(bytes("<html><script>"), "image/png")).toBe(
            false,
        );
        expect(mediaBytesMatchType(bytes("#!/bin/sh"), "audio/mpeg")).toBe(
            false,
        );
    });

    it("rejects truncated input and unknown types", () => {
        expect(mediaBytesMatchType(bytes([0x89, 0x50]), "image/png")).toBe(
            false,
        );
        expect(mediaBytesMatchType(new Uint8Array(), "audio/ogg")).toBe(false);
        expect(mediaBytesMatchType(SAMPLES["image/png"]!, "text/html")).toBe(
            false,
        );
    });

    it("matches MIME types case-insensitively", () => {
        expect(mediaBytesMatchType(SAMPLES["image/png"]!, "IMAGE/PNG")).toBe(
            true,
        );
    });
});
