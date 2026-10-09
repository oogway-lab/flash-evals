import { readFile } from "node:fs/promises";
import path from "node:path";
import { createGateway } from "@ai-sdk/gateway";
import { transcribeOpenRouterAudio } from "@mosaic/llm-core";
import type {
    ICreateSttRouteProbeRequest,
    ISttRouteProbeModel,
    ISttRouteProbeResponse,
    SttProviderId,
    SttRouteProbeStatus,
} from "@mosaic/api-contract";
import type { IApiConfig } from "../config.js";
import type { IDb } from "../db.js";
import { ApiBadRequestError, ApiNotFoundError } from "../errors.js";
import { resolveApiKeys } from "../secrets/resolveApiKeys.js";
import {
    resolveSttModelDefinition,
    sttModelCanProbe,
    sttModelOptions,
    type ISttCapabilityProbeStatus,
    type SttCapabilityProbeResults,
} from "../sttModels.js";

const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface IProbeRow {
    modelId: string;
    routeId: string;
    status: SttRouteProbeStatus;
    reason: string | null;
    probedAt: Date;
}

export async function listSttRouteProbesPayload(
    db: IDb,
    config: IApiConfig,
    teamId: string,
    projectId: string,
): Promise<ISttRouteProbeModel[]> {
    validateScopeIds(teamId, projectId);
    await assertProjectScope(db, teamId, projectId);
    const resolved = await resolveApiKeys(db, config, teamId);
    const effectiveConfig = configWithResolvedKeys(
        config,
        resolved.sttProviderKeys,
    );
    const rows = await probeRows(db, teamId, projectId);
    const effectiveProbes = mergedProbeResults(
        config.sttCapabilityProbes,
        rows,
    );
    const rowByModel = new Map(rows.map((row) => [row.modelId, row]));
    return sttModelOptions(effectiveConfig, effectiveProbes)
        .filter((model) => sttModelCanProbe(model.id))
        .filter((model) => !config.sttCapabilityProbes[model.id])
        .filter((model) => model.availabilityStatus !== "missing_key")
        .map((model) => {
            const row = rowByModel.get(model.id);
            return {
                modelId: model.id,
                label: model.label,
                providerId: model.providerId ?? "openai",
                providerLabel:
                    model.providerLabel ?? model.providerId ?? "OpenAI",
                routeId:
                    model.routeId ??
                    resolveSttModelDefinition(model.id)?.routeId ??
                    "",
                availabilityStatus:
                    model.availabilityStatus ?? "unverified_route",
                ...(model.unavailableReason
                    ? { unavailableReason: model.unavailableReason }
                    : {}),
                ...(row
                    ? {
                          probe: {
                              status: row.status,
                              ...(row.reason ? { reason: row.reason } : {}),
                              probedAt: row.probedAt.toISOString(),
                          },
                      }
                    : {}),
            };
        });
}

export async function createSttRouteProbePayload(
    db: IDb,
    config: IApiConfig,
    input: ICreateSttRouteProbeRequest,
): Promise<ISttRouteProbeResponse> {
    validateScopeIds(input.teamId, input.projectId);
    if (!UUID_PATTERN.test(input.probedBy)) {
        throw new ApiBadRequestError("probedBy must be a valid UUID");
    }
    await assertProjectAndUserScope(
        db,
        input.teamId,
        input.projectId,
        input.probedBy,
    );
    const definition = resolveSttModelDefinition(input.modelId);
    if (!definition || !sttModelCanProbe(input.modelId)) {
        throw new ApiBadRequestError(
            "modelId is not a probe-enabled STT model",
        );
    }
    if (config.sttCapabilityProbes[definition.id]) {
        throw new ApiBadRequestError(
            "This STT route is managed by MOSAIC_STT_CAPABILITY_PROBES.",
        );
    }
    const keys = await resolveApiKeys(db, config, input.teamId);
    const credential = probeCredential(
        definition.providerId,
        keys.sttProviderKeys,
    );
    const probedAt = new Date();
    let status: SttRouteProbeStatus;
    let transcript: string | undefined;
    let error: string | undefined;
    try {
        transcript = await executeProbe(input.modelId, keys.sttProviderKeys);
        status = "available";
    } catch (caught) {
        error = probeFailureReason(caught, definition.providerLabel);
        status =
            caught instanceof SttProbeProviderError && caught.status === 415
                ? "unsupported_input"
                : "failed";
    }
    const currentKeys = await resolveApiKeys(db, config, input.teamId);
    if (
        probeCredential(definition.providerId, currentKeys.sttProviderKeys) !==
        credential
    ) {
        throw new ApiBadRequestError(
            "The provider key changed during route verification. Verify the route again.",
        );
    }
    await persistProbe(db, {
        ...input,
        routeId: definition.routeId,
        status,
        reason: error,
        probedAt,
    });
    return {
        modelId: definition.id,
        routeId: definition.routeId,
        status,
        ...(transcript ? { transcript } : {}),
        ...(error ? { error } : {}),
        probedAt: probedAt.toISOString(),
    };
}

export async function teamSttCapabilityProbes(
    db: IDb,
    config: IApiConfig,
    teamId: string,
    projectId: string,
): Promise<SttCapabilityProbeResults> {
    return mergedProbeResults(
        config.sttCapabilityProbes,
        await probeRows(db, teamId, projectId),
    );
}

export async function configWithTeamSttProbes(
    db: IDb,
    config: IApiConfig,
    teamId: string,
    projectId: string,
): Promise<IApiConfig> {
    return {
        ...config,
        sttCapabilityProbes: await teamSttCapabilityProbes(
            db,
            config,
            teamId,
            projectId,
        ),
    };
}

export async function globalSttCapabilityProbes(
    db: IDb,
    envProbes: SttCapabilityProbeResults,
): Promise<SttCapabilityProbeResults> {
    const result = await db.query<IProbeRow>(
        `select distinct on (model_id)
            model_id as "modelId", route_id as "routeId", status, reason,
            probed_at as "probedAt"
        from stt_route_probes
        order by model_id, probed_at desc`,
    );
    return mergedProbeResults(envProbes, result.rows);
}

export async function globalStoredSttProviders(db: IDb): Promise<Set<string>> {
    const result = await db.query<{ provider: string }>(
        "select distinct provider from provider_keys",
    );
    return new Set(
        result.rows.flatMap((row) =>
            typeof row.provider === "string" ? [row.provider] : [],
        ),
    );
}

function mergedProbeResults(
    envProbes: SttCapabilityProbeResults,
    rows: IProbeRow[],
): SttCapabilityProbeResults {
    const persisted = Object.fromEntries(
        rows.map((row) => [row.modelId, probeStatus(row)]),
    );
    return { ...persisted, ...envProbes };
}

function probeStatus(row: IProbeRow): ISttCapabilityProbeStatus {
    if (row.status === "available") return { status: "available" };
    return {
        status:
            row.status === "unsupported_input"
                ? "unsupported_input"
                : "provider_error",
        ...(row.reason ? { reason: row.reason } : {}),
    };
}

async function probeRows(
    db: IDb,
    teamId: string,
    projectId: string,
): Promise<IProbeRow[]> {
    const result = await db.query<IProbeRow>(
        `select model_id as "modelId", route_id as "routeId", status, reason,
            probed_at as "probedAt"
        from stt_route_probes
        where team_id = $1 and project_id = $2`,
        [teamId, projectId],
    );
    return result.rows;
}

async function assertProjectScope(
    db: IDb,
    teamId: string,
    projectId: string,
): Promise<void> {
    const result = await db.query(
        "select 1 from projects where id = $1 and team_id = $2 limit 1",
        [projectId, teamId],
    );
    if (result.rows.length === 0)
        throw new ApiNotFoundError("Project not found");
}

async function assertProjectAndUserScope(
    db: IDb,
    teamId: string,
    projectId: string,
    userId: string,
): Promise<void> {
    const result = await db.query(
        `select 1
        from projects p
        join users u on u.id = $3 and u.team_id = p.team_id
        where p.id = $1 and p.team_id = $2
        limit 1`,
        [projectId, teamId, userId],
    );
    if (result.rows.length === 0)
        throw new ApiNotFoundError("Project not found");
}

function validateScopeIds(teamId: string, projectId: string): void {
    if (!UUID_PATTERN.test(teamId))
        throw new ApiBadRequestError("teamId must be a valid UUID");
    if (!UUID_PATTERN.test(projectId))
        throw new ApiBadRequestError("projectId must be a valid UUID");
}

async function persistProbe(
    db: IDb,
    input: ICreateSttRouteProbeRequest & {
        routeId: string;
        status: SttRouteProbeStatus;
        reason?: string;
        probedAt: Date;
    },
): Promise<void> {
    await db.query(
        `insert into stt_route_probes (
            team_id, project_id, model_id, route_id, status, reason, probed_at, probed_by
        ) values ($1, $2, $3, $4, $5, $6, $7, $8)
        on conflict (team_id, project_id, model_id) do update set
            route_id = excluded.route_id,
            status = excluded.status,
            reason = excluded.reason,
            probed_at = excluded.probed_at,
            probed_by = excluded.probed_by
        where excluded.probed_at >= stt_route_probes.probed_at`,
        [
            input.teamId,
            input.projectId,
            input.modelId,
            input.routeId,
            input.status,
            input.reason ?? null,
            input.probedAt,
            input.probedBy,
        ],
    );
}

function configWithResolvedKeys(
    config: IApiConfig,
    keys: Awaited<ReturnType<typeof resolveApiKeys>>["sttProviderKeys"],
): IApiConfig {
    return {
        ...config,
        openaiApiKey: keys.openai,
        aiGatewayApiKey: keys.vercelGateway,
        sonioxApiKey: keys.soniox,
        geminiApiKey: keys.gemini,
        openrouterApiKey: keys.openrouter,
        bifrostApiKey: keys.bifrost,
    };
}

type ProviderKeys = Awaited<
    ReturnType<typeof resolveApiKeys>
>["sttProviderKeys"];

function probeCredential(
    providerId: SttProviderId,
    keys: ProviderKeys,
): string {
    switch (providerId) {
        case "openai":
            return keys.openai ?? "";
        case "vercel-gateway":
            return keys.vercelGateway ?? "";
        case "soniox":
            return keys.soniox ?? "";
        case "gemini":
            return keys.gemini ?? "";
        case "openrouter":
            return `${keys.openrouter ?? ""}\u0000${keys.openrouterBaseUrl ?? ""}`;
        case "bifrost":
            return `${keys.bifrost ?? ""}\u0000${keys.bifrostBaseUrl ?? ""}`;
        default:
            return "";
    }
}

async function executeProbe(
    modelId: string,
    keys: ProviderKeys,
): Promise<string> {
    const definition = resolveSttModelDefinition(modelId)!;
    const audio = await readFile(
        path.resolve(process.cwd(), "src/fixtures/stt-probe-tone.wav"),
    );
    const signal = AbortSignal.timeout(60_000);
    switch (definition.providerId) {
        case "gemini":
            return probeGemini(
                definition.id.replace(/^gemini:/, ""),
                keys.gemini,
                audio,
                signal,
            );
        case "openrouter":
            if (modelId === "openrouter:google/gemini-3.8-flash") {
                if (!keys.openrouter)
                    throw new Error(
                        "Add an OpenRouter key before probing audio.",
                    );
                return (
                    await transcribeOpenRouterAudio({
                        apiKey: keys.openrouter,
                        modelId: "google/gemini-3.8-flash",
                        base64Data: audio.toString("base64"),
                        mimeType: "audio/wav",
                    })
                ).text;
            }
            return probeMultipart(
                "https://openrouter.ai/api/v1/audio/transcriptions",
                `openai/${definition.id.replace(/^openrouter:/, "")}`,
                keys.openrouter,
                audio,
                false,
                signal,
            );
        case "openai":
            return probeMultipart(
                "https://api.openai.com/v1/audio/transcriptions",
                definition.id.replace(/^openai:/, ""),
                keys.openai,
                audio,
                definition.id === "openai:gpt-4o-transcribe-diarize",
                signal,
            );
        case "soniox":
            return probeSoniox(
                definition.id.replace(/^soniox:/, ""),
                keys.soniox,
                audio,
                signal,
            );
        case "vercel-gateway":
            return probeVercelGateway(
                definition.id.replace(/^vercel:/, ""),
                keys.vercelGateway,
                audio,
            );
        default:
            throw new ApiBadRequestError(
                `Provider ${definition.providerId} cannot be probed`,
            );
    }
}

/**
 * Vercel Gateway exposes transcription through its AI SDK rather than the
 * OpenAI-compatible REST transcription endpoint.
 */
async function probeVercelGateway(
    model: string,
    key: string | undefined,
    audio: Buffer,
): Promise<string> {
    if (!key) {
        throw new ApiBadRequestError(
            "No provider key is configured for this route",
        );
    }
    const gateway = createGateway({ apiKey: key });
    const result = await gateway.transcription(model).doGenerate({
        audio: new Uint8Array(audio),
        mediaType: "audio/wav",
    });
    const text = result.text.trim();
    if (!text) throw new Error("Vercel Gateway returned an empty transcript.");
    return text;
}

async function probeMultipart(
    url: string,
    model: string,
    key: string | undefined,
    audio: Buffer,
    diarized: boolean,
    signal: AbortSignal,
): Promise<string> {
    if (!key)
        throw new ApiBadRequestError(
            "No provider key is configured for this route",
        );
    const form = new FormData();
    form.append(
        "file",
        new Blob([arrayBuffer(audio)], { type: "audio/wav" }),
        "stt-probe-tone.wav",
    );
    form.append("model", model);
    form.append("response_format", diarized ? "diarized_json" : "json");
    if (diarized) form.append("chunking_strategy", "auto");
    const response = await probeFetch(
        url,
        {
            method: "POST",
            headers: { Authorization: `Bearer ${key}` },
            body: form,
        },
        signal,
    );
    const body = await response.text();
    if (!response.ok) throw new SttProbeProviderError(response.status, body);
    const parsed = JSON.parse(body) as { text?: unknown };
    const text = typeof parsed.text === "string" ? parsed.text.trim() : "";
    if (!text) throw new Error(body || "Provider returned an empty transcript");
    return text;
}

async function probeGemini(
    model: string,
    key: string | undefined,
    audio: Buffer,
    signal: AbortSignal,
): Promise<string> {
    if (!key) throw new ApiBadRequestError("No Gemini key is configured");
    const response = await probeFetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-goog-api-key": key,
            },
            body: JSON.stringify({
                contents: [
                    {
                        parts: [
                            {
                                text: "Transcribe this audio exactly. Return only the requested JSON.",
                            },
                            {
                                inlineData: {
                                    mimeType: "audio/wav",
                                    data: audio.toString("base64"),
                                },
                            },
                        ],
                    },
                ],
                generationConfig: {
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: "OBJECT",
                        properties: {
                            text: { type: "STRING" },
                            segments: {
                                type: "ARRAY",
                                items: {
                                    type: "OBJECT",
                                    properties: {
                                        text: { type: "STRING" },
                                        speaker: { type: "STRING" },
                                        startMs: { type: "INTEGER" },
                                        endMs: { type: "INTEGER" },
                                    },
                                    required: ["text"],
                                },
                            },
                        },
                        required: ["text", "segments"],
                    },
                    maxOutputTokens: 32_768,
                },
            }),
        },
        signal,
    );
    const body = await response.text();
    if (!response.ok) throw new SttProbeProviderError(response.status, body);
    const parsed = JSON.parse(body) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const responseText = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
    const result = responseText
        ? (JSON.parse(responseText) as { text?: unknown })
        : undefined;
    const text = typeof result?.text === "string" ? result.text.trim() : "";
    if (!text) throw new Error(body || "Gemini returned an empty transcript");
    return text;
}

async function probeSoniox(
    model: string,
    key: string | undefined,
    audio: Buffer,
    signal: AbortSignal,
): Promise<string> {
    if (!key) throw new ApiBadRequestError("No Soniox key is configured");
    const upload = new FormData();
    upload.append(
        "file",
        new Blob([arrayBuffer(audio)], { type: "audio/wav" }),
        "stt-probe-tone.wav",
    );
    const uploaded = await providerJson(
        "https://api.soniox.com/v1/files",
        {
            method: "POST",
            headers: { Authorization: `Bearer ${key}` },
            body: upload,
        },
        signal,
    );
    const fileId = stringProperty(uploaded, "id");
    if (!fileId) throw new Error(JSON.stringify(uploaded));
    const created = await providerJson(
        "https://api.soniox.com/v1/transcriptions",
        {
            method: "POST",
            headers: {
                Authorization: `Bearer ${key}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ model, file_id: fileId }),
        },
        signal,
    );
    const transcriptionId = stringProperty(created, "id");
    if (!transcriptionId) throw new Error(JSON.stringify(created));
    for (let attempt = 0; attempt < 30; attempt += 1) {
        const state = await providerJson(
            `https://api.soniox.com/v1/transcriptions/${transcriptionId}`,
            { headers: { Authorization: `Bearer ${key}` } },
            signal,
        );
        if (stringProperty(state, "status") === "completed") break;
        if (stringProperty(state, "status") === "error") {
            throw new Error(
                stringProperty(state, "error_message") ?? JSON.stringify(state),
            );
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
        if (signal.aborted) throw new Error("STT route probe timed out.");
        if (attempt === 29) throw new Error("Soniox route probe timed out");
    }
    const transcript = await providerJson(
        `https://api.soniox.com/v1/transcriptions/${transcriptionId}/transcript`,
        { headers: { Authorization: `Bearer ${key}` } },
        signal,
    );
    const text = stringProperty(transcript, "text")?.trim();
    if (!text) throw new Error(JSON.stringify(transcript));
    return text;
}

async function providerJson(
    url: string,
    init: RequestInit,
    signal: AbortSignal,
): Promise<Record<string, unknown>> {
    const response = await probeFetch(url, init, signal);
    const body = await response.text();
    if (!response.ok) throw new SttProbeProviderError(response.status, body);
    const parsed = JSON.parse(body) as unknown;
    if (!isRecord(parsed))
        throw new Error(body || "Provider returned invalid JSON");
    return parsed;
}

async function probeFetch(
    url: string,
    init: RequestInit,
    overallSignal: AbortSignal,
): Promise<Response> {
    try {
        return await fetch(url, {
            ...init,
            signal: AbortSignal.any([
                overallSignal,
                AbortSignal.timeout(30_000),
            ]),
        });
    } catch (error) {
        if (
            overallSignal.aborted ||
            (error instanceof Error &&
                (error.name === "TimeoutError" || error.name === "AbortError"))
        ) {
            throw new Error("STT route probe timed out.");
        }
        throw error;
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringProperty(
    value: Record<string, unknown>,
    key: string,
): string | undefined {
    const property = value[key];
    return typeof property === "string" && property.length > 0
        ? property
        : undefined;
}

function arrayBuffer(buffer: Buffer): ArrayBuffer {
    const bytes = new Uint8Array(buffer.byteLength);
    bytes.set(buffer);
    return bytes.buffer;
}

class SttProbeProviderError extends Error {
    constructor(
        readonly status: number,
        body: string,
    ) {
        super(providerFailureMessage(status, body));
        this.name = "SttProbeProviderError";
    }
}

function probeFailureReason(caught: unknown, providerLabel: string): string {
    if (caught instanceof SttProbeProviderError) return caught.message;
    if (caught instanceof ApiBadRequestError) return caught.message;
    return `${providerLabel} could not verify this transcription route. Check the model and provider credentials, then try again.`;
}

function providerFailureMessage(status: number, body: string): string {
    if (status === 401 || status === 403) {
        return "The provider rejected the stored API key for this transcription route.";
    }
    if (status === 404) {
        return "The provider does not expose the requested transcription route.";
    }
    if (status === 415) {
        return "The provider does not accept the built-in non-speech audio probe.";
    }
    if (body.trim()) {
        return `The provider rejected this transcription verification request (HTTP ${status}).`;
    }
    return `The provider returned HTTP ${status} while verifying this transcription route.`;
}
