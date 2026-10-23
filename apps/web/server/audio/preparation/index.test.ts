import { execFileSync, spawnSync } from "child_process";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
    afterAll,
    afterEach,
    beforeAll,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import { AUDIO_PREPARATION_VERSION, prepareAudioForTranscription } from ".";
import { withAudioWorkspace, withHeavyAudioSlot } from "./ffmpeg";

const hasFfmpeg =
    spawnSync("ffmpeg", ["-version"]).status === 0 &&
    spawnSync("ffprobe", ["-version"]).status === 0;

const WAV_OR_MP3 = new Set(["audio/wav", "audio/mpeg"]);
const policy = {
    maxBytes: 14 * 1024 * 1024,
    maxDurationMs: 60_000,
    acceptedMimeTypes: WAV_OR_MP3,
};

afterEach(() => vi.unstubAllEnvs());

describe.skipIf(!hasFfmpeg)("prepareAudioForTranscription with FFmpeg", () => {
    let dir: string;
    let longWav: Buffer;
    let shortWav: Buffer;

    beforeAll(() => {
        dir = mkdtempSync(join(tmpdir(), "flash-evals-prep-test-"));
        // 150 s stereo 44.1 kHz tone (~26 MB) with silences at 55-57 s and 110-112 s.
        execFileSync("ffmpeg", [
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=150",
            "-af",
            "volume=enable='between(t,55,57)+between(t,110,112)':volume=0",
            "-ac",
            "2",
            "-ar",
            "44100",
            join(dir, "long.wav"),
        ]);
        execFileSync("ffmpeg", [
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=5",
            join(dir, "short.wav"),
        ]);
        longWav = readFileSync(join(dir, "long.wav"));
        shortWav = readFileSync(join(dir, "short.wav"));
    });

    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    it("sends audio within budget unchanged", async () => {
        const result = await prepareAudioForTranscription({
            bytes: shortWav,
            mimeType: "audio/wav",
            policy,
        });
        expect(result.kind).toBe("original");
    });

    it("probes small files while a long conversion holds the heavy slot", async () => {
        let releaseHeavy!: () => void;
        const held = withHeavyAudioSlot(
            () => new Promise<void>((resolve) => (releaseHeavy = resolve)),
        );
        await expect(
            prepareAudioForTranscription({
                bytes: shortWav,
                mimeType: "audio/wav",
                policy,
            }),
        ).resolves.toMatchObject({ kind: "original" });
        releaseHeavy();
        await held;
    });

    it("compresses and splits oversized audio at silences", async () => {
        expect(longWav.byteLength).toBeGreaterThan(policy.maxBytes);
        const result = await prepareAudioForTranscription({
            bytes: longWav,
            mimeType: "audio/wav",
            policy,
        });
        if (result.kind !== "prepared") throw new Error("expected chunks");
        expect(result.version).toBe(AUDIO_PREPARATION_VERSION);
        expect(result.probe).toMatchObject({ channels: 2, sampleRate: 44_100 });
        expect(Math.abs(result.probe.durationMs - 150_000)).toBeLessThan(100);
        expect(result.chunks).toHaveLength(3);
        const [first, second, third] = result.chunks;
        expect(first!.startMs).toBe(0);
        expect(first!.endMs).toBeGreaterThan(55_000);
        expect(first!.endMs).toBeLessThan(57_000);
        expect(second!.startMs).toBe(first!.endMs);
        expect(second!.endMs).toBeGreaterThan(110_000);
        expect(second!.endMs).toBeLessThan(112_000);
        expect(third!.endMs).toBe(result.probe.durationMs);
        for (const chunk of result.chunks) {
            expect(chunk.hardCut).toBe(false);
            expect(chunk.mimeType).toBe("audio/mpeg");
            expect(chunk.bytes.byteLength).toBeLessThan(1024 * 1024);
        }
    });

    it("re-encodes an unsupported format even when it is small", async () => {
        const flac = join(dir, "short.flac");
        execFileSync("ffmpeg", [
            "-loglevel",
            "error",
            "-i",
            join(dir, "short.wav"),
            flac,
        ]);
        const result = await prepareAudioForTranscription({
            bytes: readFileSync(flac),
            mimeType: "audio/flac",
            policy,
        });
        expect(result.kind).toBe("prepared");
        if (result.kind === "prepared") expect(result.chunks).toHaveLength(1);
    });

    it("rejects bytes that are not audio as a permanent error", async () => {
        await expect(
            prepareAudioForTranscription({
                bytes: Buffer.from("not audio"),
                mimeType: "audio/wav",
                policy: { ...policy, maxBytes: 1 },
            }),
        ).rejects.toThrow(/FFprobe could not read the audio/);
    });
});

describe("audio workspace limits", () => {
    it("does not hold work back after a temp directory or heavy step fails", async () => {
        vi.stubEnv("TMPDIR", "/nonexistent/flash-evals-tmp");
        await expect(
            withAudioWorkspace(Buffer.alloc(1), async () => 1),
        ).rejects.toThrow();
        vi.unstubAllEnvs();
        await expect(
            withHeavyAudioSlot(async () => {
                throw new Error("encode failed");
            }),
        ).rejects.toThrow("encode failed");
        await expect(withHeavyAudioSlot(async () => "next")).resolves.toBe(
            "next",
        );
        await expect(
            withAudioWorkspace(Buffer.alloc(1), async () => "ok"),
        ).resolves.toBe("ok");
    });
});

describe("prepareAudioForTranscription without FFmpeg", () => {
    it("keeps in-budget audio working and explains oversized audio", async () => {
        vi.stubEnv("FFPROBE_PATH", "/nonexistent/ffprobe");
        await expect(
            prepareAudioForTranscription({
                bytes: Buffer.alloc(10),
                mimeType: "audio/wav",
                policy,
            }),
        ).resolves.toEqual({ kind: "original" });
        await expect(
            prepareAudioForTranscription({
                bytes: Buffer.alloc(10),
                mimeType: "audio/wav",
                policy: { ...policy, maxBytes: 5 },
            }),
        ).rejects.toThrow(/FFprobe is not available on this worker/);
    });

    it("skips preparation for providers without a policy", async () => {
        await expect(
            prepareAudioForTranscription({
                bytes: Buffer.alloc(10),
                mimeType: "audio/webm",
                policy: undefined,
            }),
        ).resolves.toEqual({ kind: "original" });
    });
});
