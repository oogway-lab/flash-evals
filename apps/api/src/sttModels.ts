import type {
    ISttModelConfigField,
    IRunSetupSttModelOption,
    SttModelAvailabilityStatus,
    SttOutputKind,
    SttProviderId,
    ProviderKeyProvider,
} from "@mosaic/api-contract";
import {
    invalidSttConfigMessagesForModelId,
    sttConfigFieldsForModelId,
    unsupportedSttConfigKeysForFields,
} from "@mosaic/api-contract";
import type { IApiConfig } from "./config.js";

interface ISttModelDefinition {
    id: string;
    aliases?: string[];
    label: string;
    providerId: SttProviderId;
    providerLabel: string;
    routeId: string;
    outputKind: SttOutputKind;
    requiredKey?: keyof Pick<
        IApiConfig,
        | "openaiApiKey"
        | "aiGatewayApiKey"
        | "sonioxApiKey"
        | "geminiApiKey"
        | "openrouterApiKey"
        | "bifrostApiKey"
    >;
    configFields: ISttModelConfigField[];
    runnable: boolean;
    probeCanEnable?: boolean;
    unavailableWhenConfigured?: string;
}

export interface ISttCapabilityProbeStatus {
    status:
        | "available"
        | "provider_error"
        | "unsupported_input"
        | "unverified_route";
    reason?: string;
}

export type SttCapabilityProbeResults = Record<
    string,
    ISttCapabilityProbeStatus
>;

const STT_MODELS: ISttModelDefinition[] = [
    {
        id: "openrouter:google/gemini-3.8-flash",
        label: "Gemini 3.8 Flash",
        providerId: "openrouter",
        providerLabel: "OpenRouter",
        routeId: "openrouter-gemini-audio",
        outputKind: "plain_transcript",
        requiredKey: "openrouterApiKey",
        configFields: sttConfigFieldsForModelId(
            "openrouter:google/gemini-3.8-flash",
        ),
        runnable: false,
        probeCanEnable: true,
        unavailableWhenConfigured:
            "Run the Gemini audio capability probe in Settings to enable this route. Supports WAV and MP3 up to 14 MB.",
    },
    {
        id: "gpt-4o-transcribe",
        aliases: ["openai:gpt-4o-transcribe"],
        label: "GPT-4o Transcribe",
        providerId: "openai",
        providerLabel: "OpenAI",
        routeId: "openai-audio-transcriptions",
        outputKind: "plain_transcript",
        requiredKey: "openaiApiKey",
        configFields: sttConfigFieldsForModelId("gpt-4o-transcribe"),
        runnable: true,
    },
    {
        id: "gpt-4o-mini-transcribe",
        aliases: ["openai:gpt-4o-mini-transcribe"],
        label: "GPT-4o mini Transcribe",
        providerId: "openai",
        providerLabel: "OpenAI",
        routeId: "openai-audio-transcriptions",
        outputKind: "plain_transcript",
        requiredKey: "openaiApiKey",
        configFields: sttConfigFieldsForModelId("gpt-4o-mini-transcribe"),
        runnable: true,
    },
    {
        id: "whisper-1",
        aliases: ["openai:whisper-1"],
        label: "Whisper",
        providerId: "openai",
        providerLabel: "OpenAI",
        routeId: "openai-audio-transcriptions",
        outputKind: "plain_transcript",
        requiredKey: "openaiApiKey",
        configFields: sttConfigFieldsForModelId("whisper-1"),
        runnable: true,
    },
    {
        id: "openai:gpt-4o-transcribe-diarize",
        label: "GPT-4o Transcribe Diarize",
        providerId: "openai",
        providerLabel: "OpenAI",
        routeId: "openai-audio-transcriptions",
        outputKind: "diarized_transcript",
        requiredKey: "openaiApiKey",
        configFields: sttConfigFieldsForModelId(
            "openai:gpt-4o-transcribe-diarize",
        ),
        runnable: false,
        probeCanEnable: true,
        unavailableWhenConfigured:
            "Verify the OpenAI diarized transcription route before using it.",
    },
    {
        id: "vercel:openai/gpt-4o-transcribe",
        label: "GPT-4o Transcribe",
        providerId: "vercel-gateway",
        providerLabel: "Vercel AI Gateway",
        routeId: "vercel-ai-gateway-stt",
        outputKind: "plain_transcript",
        requiredKey: "aiGatewayApiKey",
        configFields: sttConfigFieldsForModelId(
            "vercel:openai/gpt-4o-transcribe",
        ),
        runnable: false,
        probeCanEnable: true,
        unavailableWhenConfigured:
            "Vercel Gateway STT is beta; run a provider smoke and set MOSAIC_STT_CAPABILITY_PROBES before enabling this route.",
    },
    {
        id: "vercel:openai/gpt-4o-mini-transcribe",
        label: "GPT-4o mini Transcribe",
        providerId: "vercel-gateway",
        providerLabel: "Vercel AI Gateway",
        routeId: "vercel-ai-gateway-stt",
        outputKind: "plain_transcript",
        requiredKey: "aiGatewayApiKey",
        configFields: sttConfigFieldsForModelId(
            "vercel:openai/gpt-4o-mini-transcribe",
        ),
        runnable: false,
        probeCanEnable: true,
        unavailableWhenConfigured:
            "Vercel Gateway STT is beta; run a provider smoke and set MOSAIC_STT_CAPABILITY_PROBES before enabling this route.",
    },
    {
        id: "vercel:openai/whisper-1",
        label: "Whisper",
        providerId: "vercel-gateway",
        providerLabel: "Vercel AI Gateway",
        routeId: "vercel-ai-gateway-stt",
        outputKind: "plain_transcript",
        requiredKey: "aiGatewayApiKey",
        configFields: sttConfigFieldsForModelId("vercel:openai/whisper-1"),
        runnable: false,
        probeCanEnable: true,
        unavailableWhenConfigured:
            "Vercel Gateway STT is beta; run a provider smoke and set MOSAIC_STT_CAPABILITY_PROBES before enabling this route.",
    },
    {
        id: "soniox:stt-async-v5",
        label: "Soniox STT async v5",
        providerId: "soniox",
        providerLabel: "Soniox",
        routeId: "soniox-async-file-transcription",
        outputKind: "diarized_transcript",
        requiredKey: "sonioxApiKey",
        configFields: sttConfigFieldsForModelId("soniox:stt-async-v5"),
        runnable: true,
        probeCanEnable: true,
    },
    {
        id: "openrouter:whisper-large-v3-turbo",
        label: "Whisper large v3 turbo",
        providerId: "openrouter",
        providerLabel: "OpenRouter",
        routeId: "openrouter-audio-transcriptions",
        outputKind: "plain_transcript",
        requiredKey: "openrouterApiKey",
        configFields: sttConfigFieldsForModelId(
            "openrouter:whisper-large-v3-turbo",
        ),
        runnable: false,
        probeCanEnable: true,
        unavailableWhenConfigured:
            "OpenRouter STT route needs capability verification before it can run.",
    },
    {
        id: "bifrost:whisper-large-v3-turbo",
        label: "Whisper large v3 turbo",
        providerId: "bifrost",
        providerLabel: "Bifrost",
        routeId: "bifrost-stt-unverified",
        outputKind: "plain_transcript",
        configFields: sttConfigFieldsForModelId(
            "bifrost:whisper-large-v3-turbo",
        ),
        runnable: false,
        probeCanEnable: false,
        unavailableWhenConfigured:
            "Bifrost cannot route this model's audio; use the OpenRouter route",
    },
    {
        id: "gemini:gemini-2.5-flash",
        label: "Gemini 2.5 Flash audio",
        providerId: "gemini",
        providerLabel: "Gemini",
        routeId: "gemini-generate-content-audio",
        outputKind: "audio_understanding_transcript",
        requiredKey: "geminiApiKey",
        configFields: sttConfigFieldsForModelId("gemini:gemini-2.5-flash"),
        runnable: false,
        probeCanEnable: true,
        unavailableWhenConfigured:
            "Verify the Gemini audio-understanding route before using it.",
    },
    {
        id: "gemini:gemini-2.5-flash-lite",
        label: "Gemini Flash Lite audio",
        providerId: "gemini",
        providerLabel: "Gemini",
        routeId: "gemini-generate-content-audio",
        outputKind: "audio_understanding_transcript",
        requiredKey: "geminiApiKey",
        configFields: sttConfigFieldsForModelId("gemini:gemini-2.5-flash-lite"),
        runnable: false,
        probeCanEnable: true,
        unavailableWhenConfigured:
            "Verify the Gemini Flash Lite audio-understanding route before using it.",
    },
];

export function sttModelOptions(
    config: IApiConfig,
    probeResults: SttCapabilityProbeResults = {},
): IRunSetupSttModelOption[] {
    return STT_MODELS.map((definition) => {
        const hasKey = definition.requiredKey
            ? Boolean(config[definition.requiredKey])
            : true;
        const availability = availabilityFor(
            definition,
            hasKey,
            probeResults[definition.id],
        );
        return {
            id: definition.id,
            aliases: definition.aliases,
            label: definition.label,
            providerId: definition.providerId,
            providerLabel: definition.providerLabel,
            routeId: definition.routeId,
            outputKind: definition.outputKind,
            availabilityStatus: availability.status,
            available: availability.status === "available",
            configFields: definition.configFields,
            ...(availability.reason
                ? { unavailableReason: availability.reason }
                : {}),
        };
    });
}

export function resolveSttModelDefinition(
    modelId: string,
): ISttModelDefinition | undefined {
    return STT_MODELS.find(
        (definition) =>
            definition.id === modelId || definition.aliases?.includes(modelId),
    );
}

export function sttModelCanProbe(modelId: string): boolean {
    return resolveSttModelDefinition(modelId)?.probeCanEnable === true;
}

export function sttModelIdsForProviderKey(
    provider: ProviderKeyProvider,
): string[] {
    const providerId = provider === "gateway" ? "vercel-gateway" : provider;
    return STT_MODELS.filter((model) => model.providerId === providerId).map(
        (model) => model.id,
    );
}

export function unsupportedSttConfigKeys(
    modelId: string,
    config: Record<string, unknown> | undefined,
): string[] {
    const definition = resolveSttModelDefinition(modelId);
    if (!definition || !config) return [];
    return unsupportedSttConfigKeysForFields(definition.configFields, config);
}

export function invalidSttConfigMessages(
    modelId: string,
    config: Record<string, unknown> | undefined,
): string[] {
    const definition = resolveSttModelDefinition(modelId);
    if (!definition || !config) return [];
    return invalidSttConfigMessagesForModelId(definition.id, config);
}

function availabilityFor(
    definition: ISttModelDefinition,
    hasKey: boolean,
    probeStatus: ISttCapabilityProbeStatus | undefined,
): { status: SttModelAvailabilityStatus; reason?: string } {
    if (!hasKey) {
        return {
            status: "missing_key",
            reason: missingKeyMessage(definition),
        };
    }
    if (probeStatus?.status === "provider_error") {
        return {
            status: "provider_error",
            reason:
                probeStatus.reason ??
                `${definition.providerLabel} probe failed.`,
        };
    }
    if (probeStatus?.status === "unsupported_input") {
        return {
            status: "unsupported_input",
            reason:
                probeStatus.reason ??
                `${definition.providerLabel} does not support this audio input route.`,
        };
    }
    if (
        probeStatus?.status === "available" &&
        definition.probeCanEnable !== false
    ) {
        return { status: "available" };
    }
    if (!definition.runnable) {
        return {
            status: "unverified_route",
            reason:
                definition.unavailableWhenConfigured ??
                "This STT route needs capability verification before it can run.",
        };
    }
    return { status: "available" };
}

function missingKeyMessage(definition: ISttModelDefinition): string {
    if (!definition.requiredKey) {
        return `${definition.providerLabel} needs provider documentation and credential setup before transcription can run.`;
    }
    if (definition.requiredKey === "openaiApiKey") {
        return "Add OPENAI_API_KEY to run audio transcription.";
    }
    const envName = {
        openaiApiKey: "OPENAI_API_KEY",
        aiGatewayApiKey: "AI_GATEWAY_API_KEY",
        sonioxApiKey: "SONIOX_API_KEY",
        geminiApiKey: "GEMINI_API_KEY",
        openrouterApiKey: "OPENROUTER_API_KEY",
        bifrostApiKey: "BIFROST_API_KEY",
    }[definition.requiredKey];
    return `Add ${envName} to use ${definition.providerLabel} transcription.`;
}
