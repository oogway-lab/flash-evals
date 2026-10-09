#!/usr/bin/env node
/* global Blob, FormData, fetch */
import { readFile } from "node:fs/promises";

const DEFAULT_AUDIO_PATH = "/tmp/flash-evals-stt-smoke.wav";
const audioPath = process.env.STT_SMOKE_AUDIO_PATH || DEFAULT_AUDIO_PATH;
const providerFilter = new Set(
    (process.env.STT_SMOKE_PROVIDERS || "openai,gateway,soniox")
        .split(",")
        .map((provider) => provider.trim())
        .filter(Boolean),
);

const mimeType = mimeTypeFor(audioPath);
const results = [];
let audioRead;
let audioReadError;

if (providerFilter.has("openai")) {
    const modelId =
        process.env.STT_SMOKE_OPENAI_MODEL || "gpt-4o-mini-transcribe";
    results.push(
        await runSmoke(
            {
                provider: "openai",
                modelId,
            },
            () =>
                smokeOpenAI({
                    modelId,
                    apiKey: process.env.OPENAI_API_KEY,
                }),
        ),
    );
}

if (providerFilter.has("gateway")) {
    for (const modelId of gatewayModelIds()) {
        results.push(
            await runSmoke(
                {
                    provider: "vercel-gateway",
                    modelId,
                    capabilityId: `vercel:${modelId}`,
                },
                () =>
                    smokeGateway({
                        modelId,
                        apiKey: process.env.AI_GATEWAY_API_KEY,
                    }),
            ),
        );
    }
}

if (providerFilter.has("soniox")) {
    const modelId = process.env.STT_SMOKE_SONIOX_MODEL || "stt-async-v5";
    results.push(
        await runSmoke(
            {
                provider: "soniox",
                modelId,
            },
            () =>
                smokeSoniox({
                    modelId,
                    apiKey: process.env.SONIOX_API_KEY,
                }),
        ),
    );
}

for (const result of results) {
    console.log(JSON.stringify(redactResult(result)));
}

const probes = Object.fromEntries(
    results
        .filter((result) => result.ok && result.capabilityId)
        .map((result) => [result.capabilityId, { status: "available" }]),
);

if (Object.keys(probes).length > 0) {
    console.log(
        JSON.stringify({
            env: "MOSAIC_STT_CAPABILITY_PROBES",
            value: JSON.stringify(probes),
        }),
    );
}

async function smokeOpenAI({ modelId, apiKey }) {
    const provider = "openai";
    if (!apiKey) return skipped(provider, modelId, "OPENAI_API_KEY is missing");

    const audio = await loadAudio();
    const form = new FormData();
    form.append(
        "file",
        new Blob([new Uint8Array(audio)], { type: mimeType }),
        "smoke",
    );
    form.append("model", modelId);

    const response = await fetch(
        "https://api.openai.com/v1/audio/transcriptions",
        {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}` },
            body: form,
        },
    );
    const parsed = await parseResponse(response);
    const text = textFrom(parsed);
    return {
        provider,
        modelId,
        ok: response.ok && Boolean(text),
        status: response.status,
        text,
        error: response.ok ? undefined : errorText(parsed),
    };
}

async function smokeGateway({ modelId, apiKey }) {
    const provider = "vercel-gateway";
    if (!apiKey)
        return skipped(provider, modelId, "AI_GATEWAY_API_KEY is missing");

    const audio = await loadAudio();
    const response = await fetch(
        "https://ai-gateway.vercel.sh/v4/ai/transcription-model",
        {
            method: "POST",
            headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
                "ai-gateway-auth-method": "api-key",
                "ai-gateway-protocol-version": "0.0.1",
                "ai-model-id": modelId,
                "ai-transcription-model-specification-version": "4",
            },
            body: JSON.stringify({
                audio: audio.toString("base64"),
                mediaType: mimeType,
            }),
        },
    );
    const parsed = await parseResponse(response);
    const text = textFrom(parsed);
    return {
        provider,
        modelId,
        capabilityId: `vercel:${modelId}`,
        ok: response.ok && Boolean(text),
        status: response.status,
        text,
        error: response.ok ? undefined : errorText(parsed),
    };
}

async function smokeSoniox({ modelId, apiKey }) {
    const provider = "soniox";
    if (!apiKey) return skipped(provider, modelId, "SONIOX_API_KEY is missing");

    const fileId = await uploadSonioxFile(apiKey);
    const transcriptionId = await createSonioxTranscription({
        apiKey,
        fileId,
        modelId,
    });
    await waitForSonioxTranscription({ apiKey, transcriptionId });
    const transcript = await getSonioxTranscript({ apiKey, transcriptionId });
    const text = textFrom(transcript);
    return {
        provider,
        modelId,
        ok: Boolean(text),
        status: 200,
        text,
    };
}

async function uploadSonioxFile(apiKey) {
    const audio = await loadAudio();
    const form = new FormData();
    form.append(
        "file",
        new Blob([new Uint8Array(audio)], { type: mimeType }),
        "smoke",
    );
    const response = await fetch("https://api.soniox.com/v1/files", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
    });
    const parsed = await parseResponse(response);
    if (!response.ok)
        throw new Error(`Soniox file upload failed: ${errorText(parsed)}`);
    if (typeof parsed?.id !== "string") {
        throw new Error("Soniox file upload returned no file id");
    }
    return parsed.id;
}

async function createSonioxTranscription({ apiKey, fileId, modelId }) {
    const response = await fetch("https://api.soniox.com/v1/transcriptions", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            model: modelId,
            file_id: fileId,
            enable_speaker_diarization: true,
            enable_language_identification: true,
        }),
    });
    const parsed = await parseResponse(response);
    if (!response.ok) {
        throw new Error(
            `Soniox transcription create failed: ${errorText(parsed)}`,
        );
    }
    if (typeof parsed?.id !== "string") {
        throw new Error("Soniox transcription create returned no id");
    }
    return parsed.id;
}

async function waitForSonioxTranscription({ apiKey, transcriptionId }) {
    for (let attempt = 0; attempt < 30; attempt += 1) {
        const response = await fetch(
            `https://api.soniox.com/v1/transcriptions/${transcriptionId}`,
            {
                headers: { Authorization: `Bearer ${apiKey}` },
            },
        );
        const parsed = await parseResponse(response);
        if (!response.ok) {
            throw new Error(
                `Soniox transcription status failed: ${errorText(parsed)}`,
            );
        }
        if (parsed?.status === "completed") return;
        if (parsed?.status === "error") {
            throw new Error(
                `Soniox transcription failed: ${parsed.error_message || "unknown"}`,
            );
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw new Error("Soniox transcription timed out");
}

async function getSonioxTranscript({ apiKey, transcriptionId }) {
    const response = await fetch(
        `https://api.soniox.com/v1/transcriptions/${transcriptionId}/transcript`,
        {
            headers: { Authorization: `Bearer ${apiKey}` },
        },
    );
    const parsed = await parseResponse(response);
    if (!response.ok) {
        throw new Error(`Soniox transcript fetch failed: ${errorText(parsed)}`);
    }
    return parsed;
}

async function parseResponse(response) {
    const body = await response.text();
    if (!body) return {};
    try {
        return JSON.parse(body);
    } catch {
        return { text: body };
    }
}

function gatewayModelIds() {
    return (
        process.env.STT_SMOKE_GATEWAY_MODELS ||
        "openai/whisper-1,openai/gpt-4o-transcribe,openai/gpt-4o-mini-transcribe"
    )
        .split(",")
        .map((modelId) => modelId.trim())
        .filter(Boolean);
}

function skipped(provider, modelId, reason) {
    return { provider, modelId, ok: false, skipped: true, reason };
}

async function loadAudio() {
    if (audioRead) return audioRead;
    if (audioReadError) throw audioReadError;
    try {
        audioRead = await readFile(audioPath);
        return audioRead;
    } catch (error) {
        audioReadError = new Error(
            `Unable to read STT smoke audio at ${audioPath}: ${
                error instanceof Error ? error.message : String(error)
            }`,
        );
        throw audioReadError;
    }
}

async function runSmoke(fallback, fn) {
    try {
        return await fn();
    } catch (error) {
        return {
            ...fallback,
            ok: false,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

function redactResult(result) {
    return {
        provider: result.provider,
        modelId: result.modelId,
        ok: result.ok,
        ...(result.skipped ? { skipped: true } : {}),
        ...(typeof result.status === "number" ? { status: result.status } : {}),
        ...(result.text ? { text: result.text.slice(0, 120) } : {}),
        ...(result.error ? { error: result.error.slice(0, 240) } : {}),
        ...(result.reason ? { reason: result.reason } : {}),
    };
}

function textFrom(value) {
    if (typeof value?.text === "string") return value.text.trim();
    if (typeof value?.transcript === "string") return value.transcript.trim();
    if (Array.isArray(value?.tokens)) {
        return value.tokens
            .map((token) => token?.text)
            .filter((token) => typeof token === "string")
            .join(" ")
            .replace(/\s+/g, " ")
            .trim();
    }
    return "";
}

function errorText(value) {
    if (typeof value?.error?.message === "string") return value.error.message;
    if (typeof value?.message === "string") return value.message;
    if (typeof value?.error_message === "string") return value.error_message;
    return JSON.stringify(value);
}

function mimeTypeFor(path) {
    const lower = path.toLowerCase();
    if (lower.endsWith(".mp3")) return "audio/mpeg";
    if (lower.endsWith(".m4a") || lower.endsWith(".mp4")) return "audio/mp4";
    if (lower.endsWith(".webm")) return "audio/webm";
    if (lower.endsWith(".ogg")) return "audio/ogg";
    if (lower.endsWith(".flac")) return "audio/flac";
    return "audio/wav";
}
