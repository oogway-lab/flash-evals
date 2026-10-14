import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_IMAGE_BYTES, MAX_IMPORT_FILE_COUNT } from "@mosaic/api-contract";
import { UploadError, uploadFiles } from "./direct-upload";

const SIGN_ENDPOINT = "/api/datasets/upload/sign";

function makeFile(
    name: string,
    { size = 1024, type = "image/png" }: { size?: number; type?: string } = {},
): File {
    const file = new File(["x"], name, { type });
    // jsdom derives size from the blob parts; override to hit cap logic cheaply.
    Object.defineProperty(file, "size", { value: size });
    return file;
}

function signResponse(
    storageKeys: string[],
    headers: Record<string, string> = {},
): Response {
    return new Response(
        JSON.stringify({
            targets: storageKeys.map((storageKey, i) => ({
                storageKey,
                signedUrl: `https://storage.example/put/${i}?token=t${i}`,
                headers,
            })),
        }),
        { status: 200, headers: { "content-type": "application/json" } },
    );
}

function isSignCall(input: RequestInfo | URL): boolean {
    return typeof input === "string" && input === SIGN_ENDPOINT;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("uploadFiles", () => {
    it("happy path: signs once and PUTs each file with the correct content-type", async () => {
        const files = [
            makeFile("a.png", { type: "image/png" }),
            makeFile("b.jpg", { type: "image/jpeg" }),
            makeFile("c.webp", { type: "image/webp" }),
        ];
        const keys = ["k/a", "k/b", "k/c"];

        fetchMock.mockImplementation((input: RequestInfo | URL) => {
            if (isSignCall(input)) {
                return Promise.resolve(
                    signResponse(keys, { "If-None-Match": "*" }),
                );
            }
            return Promise.resolve(new Response(null, { status: 200 }));
        });

        const progress: Array<[number, number]> = [];
        const result = await uploadFiles({
            datasetId: "ds-1",
            modality: "image",
            files,
            onProgress: (done, total) => progress.push([done, total]),
        });

        // One sign call + three PUTs.
        const signCalls = fetchMock.mock.calls.filter((c) => isSignCall(c[0]));
        const putCalls = fetchMock.mock.calls.filter((c) => !isSignCall(c[0]));
        expect(signCalls).toHaveLength(1);
        expect(putCalls).toHaveLength(3);

        for (const [, init] of putCalls) {
            expect(init.method).toBe("PUT");
            expect(init.headers["x-upsert"]).toBeUndefined();
            expect(init.headers["If-None-Match"]).toBe("*");
        }
        // Content-type matches each file's type.
        const sentTypes = putCalls.map((c) => c[1].headers["Content-Type"]);
        expect(sentTypes).toEqual(
            expect.arrayContaining(["image/png", "image/jpeg", "image/webp"]),
        );

        expect(result.uploaded).toHaveLength(3);
        expect(result.failures).toHaveLength(0);
        expect(result.uploaded.map((u) => u.storageKey).sort()).toEqual([
            "k/a",
            "k/b",
            "k/c",
        ]);
        expect(progress.at(-1)).toEqual([3, 3]);
    });

    it("oversize single file throws UploadError(oversize) before any fetch", async () => {
        const files = [makeFile("huge.png", { size: MAX_IMAGE_BYTES + 1 })];

        await expect(
            uploadFiles({ datasetId: "ds-1", modality: "image", files }),
        ).rejects.toMatchObject({ kind: "oversize", fileName: "huge.png" });

        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("rejects an unsupported image type before any network call", async () => {
        await expect(
            uploadFiles({
                datasetId: "ds-1",
                modality: "image",
                files: [makeFile("notes.txt", { type: "text/plain" })],
            }),
        ).rejects.toMatchObject({
            kind: "unsupported-type",
            fileName: "notes.txt",
            message:
                '"notes.txt" has unsupported type "text/plain" for image uploads.',
        });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("rejects a mixed batch before signing and names the invalid file", async () => {
        await expect(
            uploadFiles({
                datasetId: "ds-1",
                modality: "image",
                files: [
                    makeFile("valid.png", { type: "image/png" }),
                    makeFile("invalid.txt", { type: "text/plain" }),
                ],
            }),
        ).rejects.toMatchObject({
            kind: "unsupported-type",
            fileName: "invalid.txt",
        });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("too many files throws UploadError(too-many) before signing", async () => {
        const files = Array.from(
            { length: MAX_IMPORT_FILE_COUNT + 1 },
            (_, i) => makeFile(`f${i}.png`, { size: 8 }),
        );

        await expect(
            uploadFiles({ datasetId: "ds-1", modality: "image", files }),
        ).rejects.toMatchObject({ kind: "too-many" });

        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("one PUT returning 400 yields a partial success", async () => {
        const files = [
            makeFile("ok1.png"),
            makeFile("bad.png"),
            makeFile("ok2.png"),
        ];
        const keys = ["k/ok1", "k/bad", "k/ok2"];

        fetchMock.mockImplementation((input: RequestInfo | URL) => {
            if (isSignCall(input)) return Promise.resolve(signResponse(keys));
            const url = String(input);
            // Target index 1 (bad.png) → 400.
            if (url.includes("/put/1"))
                return Promise.resolve(new Response(null, { status: 400 }));
            return Promise.resolve(new Response(null, { status: 200 }));
        });

        const result = await uploadFiles({
            datasetId: "ds-1",
            modality: "image",
            files,
        });

        expect(result.uploaded.map((u) => u.fileName).sort()).toEqual([
            "ok1.png",
            "ok2.png",
        ]);
        expect(result.failures).toHaveLength(1);
        expect(result.failures[0].fileName).toBe("bad.png");
        expect(result.failures[0].error).toBeInstanceOf(UploadError);
        expect(result.failures[0].error.kind).toBe("expired");
    });

    it("sign endpoint returning 400 throws UploadError(sign-failed) with the message", async () => {
        fetchMock.mockImplementation((input: RequestInfo | URL) => {
            if (isSignCall(input)) {
                return Promise.resolve(
                    new Response(
                        JSON.stringify({
                            error: "Audio exceeds the 250MB limit.",
                        }),
                        {
                            status: 400,
                            headers: { "content-type": "application/json" },
                        },
                    ),
                );
            }
            return Promise.resolve(new Response(null, { status: 200 }));
        });

        await expect(
            uploadFiles({
                datasetId: "ds-1",
                modality: "image",
                files: [makeFile("a.png")],
            }),
        ).rejects.toMatchObject({
            kind: "sign-failed",
            message: "Audio exceeds the 250MB limit.",
        });

        // No PUT should have been attempted.
        const putCalls = fetchMock.mock.calls.filter((c) => !isSignCall(c[0]));
        expect(putCalls).toHaveLength(0);
    });

    it("never exceeds the configured concurrency in flight", async () => {
        const files = [
            makeFile("a.png"),
            makeFile("b.png"),
            makeFile("c.png"),
            makeFile("d.png"),
        ];
        const keys = ["k/a", "k/b", "k/c", "k/d"];

        let inFlight = 0;
        let maxInFlight = 0;

        fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
            if (isSignCall(input)) return signResponse(keys);
            inFlight += 1;
            maxInFlight = Math.max(maxInFlight, inFlight);
            // Hold the slot open long enough that all workers would overlap if
            // the pool were unbounded, then release.
            await new Promise((resolve) => setTimeout(resolve, 10));
            inFlight -= 1;
            return new Response(null, { status: 200 });
        });

        const result = await uploadFiles({
            datasetId: "ds-1",
            modality: "image",
            files,
            concurrency: 2,
        });

        expect(result.uploaded).toHaveLength(4);
        expect(maxInFlight).toBe(2);
    });

    it("retries a transient PUT failure on the same URL and succeeds", async () => {
        let attempts = 0;
        fetchMock.mockImplementation((input: RequestInfo | URL) => {
            if (isSignCall(input))
                return Promise.resolve(signResponse(["k/a"]));
            attempts += 1;
            return Promise.resolve(
                new Response(null, { status: attempts < 3 ? 503 : 200 }),
            );
        });

        const result = await uploadFiles({
            datasetId: "ds-1",
            modality: "image",
            files: [makeFile("a.png")],
            retryDelayMs: 0,
        });

        expect(attempts).toBe(3);
        expect(result.uploaded).toHaveLength(1);
        expect(result.failures).toHaveLength(0);
        const signCalls = fetchMock.mock.calls.filter((c) => isSignCall(c[0]));
        expect(signCalls).toHaveLength(1);
    });

    it("re-signs only the files that still failed and retries them once", async () => {
        let signs = 0;
        fetchMock.mockImplementation(
            (input: RequestInfo | URL, init?: RequestInit) => {
                if (isSignCall(input)) {
                    signs += 1;
                    const body = JSON.parse(String(init?.body)) as {
                        files: Array<{ fileName: string }>;
                    };
                    return Promise.resolve(
                        new Response(
                            JSON.stringify({
                                targets: body.files.map((file) => ({
                                    storageKey: `k/${file.fileName}`,
                                    signedUrl: `https://storage.example/put/${file.fileName}?sign=${signs}`,
                                })),
                            }),
                            { status: 200 },
                        ),
                    );
                }
                const url = String(input);
                // bad.png's first URL is rejected; its fresh URL works.
                if (url.includes("bad.png?sign=1")) {
                    return Promise.resolve(new Response(null, { status: 403 }));
                }
                return Promise.resolve(new Response(null, { status: 200 }));
            },
        );

        const progress: Array<[number, number]> = [];
        const result = await uploadFiles({
            datasetId: "ds-1",
            modality: "image",
            files: [makeFile("ok.png"), makeFile("bad.png")],
            onProgress: (done, total) => progress.push([done, total]),
            retryDelayMs: 0,
        });

        expect(signs).toBe(2);
        const resign = JSON.parse(
            String(
                fetchMock.mock.calls.filter((c) => isSignCall(c[0]))[1][1].body,
            ),
        ) as { files: Array<{ fileName: string }> };
        expect(resign.files.map((file) => file.fileName)).toEqual(["bad.png"]);
        expect(result.failures).toHaveLength(0);
        expect(result.uploaded.map((u) => u.fileName).sort()).toEqual([
            "bad.png",
            "ok.png",
        ]);
        expect(progress.at(-1)).toEqual([2, 2]);
    });

    it("keeps uploading the rest when one file never succeeds", async () => {
        fetchMock.mockImplementation((input: RequestInfo | URL) => {
            if (isSignCall(input)) {
                return Promise.resolve(signResponse(["k/a", "k/b", "k/c"]));
            }
            return Promise.resolve(
                new Response(null, {
                    status: String(input).includes("/put/1") ? 500 : 200,
                }),
            );
        });

        const result = await uploadFiles({
            datasetId: "ds-1",
            modality: "image",
            files: [makeFile("a.png"), makeFile("b.png"), makeFile("c.png")],
            retryDelayMs: 0,
        });

        expect(result.uploaded.map((u) => u.fileName).sort()).toEqual([
            "a.png",
            "c.png",
        ]);
        expect(result.failures).toEqual([
            expect.objectContaining({
                fileName: "b.png",
                error: expect.objectContaining({ kind: "storage" }),
            }),
        ]);
    });

    it("reports bytes sent per file through XMLHttpRequest", async () => {
        class FakeXhr {
            static sent: string[] = [];
            upload: { onprogress?: (event: { loaded: number }) => void } = {};
            onload?: () => void;
            onerror?: () => void;
            status = 0;
            private url = "";
            open(_method: string, url: string) {
                this.url = url;
            }
            setRequestHeader() {}
            send(file: File) {
                FakeXhr.sent.push(this.url);
                queueMicrotask(() => {
                    this.upload.onprogress?.({ loaded: file.size / 2 });
                    this.status = 200;
                    this.onload?.();
                });
            }
        }
        vi.stubGlobal("XMLHttpRequest", FakeXhr);
        fetchMock.mockImplementation(() =>
            Promise.resolve(signResponse(["k/a"])),
        );

        const events: Array<[string, number]> = [];
        const result = await uploadFiles({
            datasetId: "ds-1",
            modality: "image",
            files: [makeFile("a.png", { size: 100 })],
            onFileProgress: (event) =>
                events.push([event.status, event.loaded]),
        });

        expect(result.uploaded).toHaveLength(1);
        expect(FakeXhr.sent).toHaveLength(1);
        expect(events).toEqual([
            ["uploading", 0],
            ["uploading", 50],
            ["done", 100],
        ]);
    });
    it("settles an aborted XMLHttpRequest as a network failure instead of hanging", async () => {
        class AbortingXhr {
            upload: { onprogress?: (event: { loaded: number }) => void } = {};
            onabort?: () => void;
            open() {}
            setRequestHeader() {}
            send() {
                queueMicrotask(() => this.onabort?.());
            }
        }
        vi.stubGlobal("XMLHttpRequest", AbortingXhr);
        fetchMock.mockImplementation(() =>
            Promise.resolve(signResponse(["k/a"])),
        );

        const result = await uploadFiles({
            datasetId: "ds-1",
            modality: "image",
            files: [makeFile("a.png", { size: 100 })],
            onFileProgress: () => {},
            retryDelayMs: 0,
        });

        expect(result.uploaded).toHaveLength(0);
        expect(result.failures).toEqual([
            expect.objectContaining({
                fileName: "a.png",
                error: expect.objectContaining({ kind: "network" }),
            }),
        ]);
    });

    it("reports bytes sent only when the whole percent changes", async () => {
        class ChattyXhr {
            upload: { onprogress?: (event: { loaded: number }) => void } = {};
            onload?: () => void;
            status = 0;
            open() {}
            setRequestHeader() {}
            send() {
                queueMicrotask(() => {
                    for (const loaded of [100, 150, 199, 200, 1000]) {
                        this.upload.onprogress?.({ loaded });
                    }
                    this.status = 200;
                    this.onload?.();
                });
            }
        }
        vi.stubGlobal("XMLHttpRequest", ChattyXhr);
        fetchMock.mockImplementation(() =>
            Promise.resolve(signResponse(["k/a"])),
        );

        const loaded: number[] = [];
        await uploadFiles({
            datasetId: "ds-1",
            modality: "image",
            files: [makeFile("a.png", { size: 10_000 })],
            onFileProgress: (event) => {
                if (event.status === "uploading") loaded.push(event.loaded);
            },
        });

        // 100, 150 and 199 bytes are all 1%; 200 is 2%; 1000 is 10%.
        expect(loaded).toEqual([0, 100, 200, 1000]);
    });
});
