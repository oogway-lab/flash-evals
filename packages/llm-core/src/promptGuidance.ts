import {
    registryEntryFor,
    registryEntryForLiveGatewayModel,
    type ModelProvider,
} from "./models/registry.js";

export interface IPromptOptimizerGuidanceSource {
    title: string;
    url: string;
    retrievedAt: string;
}

export interface IPromptOptimizerGuidance {
    text: string;
    source: IPromptOptimizerGuidanceSource;
}

const RETRIEVED_AT = "2026-07-08";

const GPT_5_GUIDANCE = {
    source: {
        title: "OpenAI GPT-5 prompting guide",
        url: "https://cookbook.openai.com/examples/gpt-5/gpt-5_prompting_guide",
        retrievedAt: RETRIEVED_AT,
    },
    text: [
        "Optimize for GPT-5/reasoning-family behavior.",
        "Be explicit about task boundaries, persistence, ambiguity handling, and output contract.",
        "Avoid asking for hidden chain-of-thought; ask for concise internal reasoning only when needed and final JSON only.",
        "Keep the final answer constrained to the supplied JSON Schema.",
    ].join("\n"),
} satisfies IPromptOptimizerGuidance;

const GPT_4_1_GUIDANCE = {
    source: {
        title: "OpenAI GPT-4.1 prompting guide",
        url: "https://cookbook.openai.com/examples/gpt4-1_prompting_guide",
        retrievedAt: RETRIEVED_AT,
    },
    text: [
        "Optimize for GPT-4.1-family instruction following.",
        "Place important instructions clearly, structure long prompts with sections, and define exact success criteria.",
        "Keep examples and schema requirements close to the task instructions.",
        "Return only a JSON object matching the supplied JSON Schema.",
    ].join("\n"),
} satisfies IPromptOptimizerGuidance;

const OPENAI_GENERAL_GUIDANCE = {
    source: {
        title: "OpenAI prompt engineering and structured outputs guides",
        url: "https://platform.openai.com/docs/guides/prompt-engineering",
        retrievedAt: RETRIEVED_AT,
    },
    text: [
        "Optimize for GPT-4o/general OpenAI chat model behavior.",
        "Use direct instructions, include relevant context, define constraints, and avoid conflicting prose output.",
        "Make the structured-output requirement explicit.",
        "Return only a JSON object matching the supplied JSON Schema.",
    ].join("\n"),
} satisfies IPromptOptimizerGuidance;

const CLAUDE_GUIDANCE = {
    source: {
        title: "Anthropic Claude prompt engineering overview",
        url: "https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/overview",
        retrievedAt: RETRIEVED_AT,
    },
    text: [
        "Optimize for Claude model behavior.",
        "State success criteria clearly, including what a correct answer must include and avoid.",
        "Use concise sectioning, XML-style tags, examples, and role context when they clarify the task.",
        "Keep structured-output requirements explicit and ask for only the JSON object matching the supplied JSON Schema.",
    ].join("\n"),
} satisfies IPromptOptimizerGuidance;

const GEMINI_GUIDANCE = {
    source: {
        title: "Google Gemini prompting strategies",
        url: "https://ai.google.dev/gemini-api/docs/prompting-strategies",
        retrievedAt: RETRIEVED_AT,
    },
    text: [
        "Optimize for Gemini model behavior.",
        "Use clear and specific instructions, break complex tasks into explicit steps, and include examples when useful.",
        "For JSON output, name the exact fields and constraints the model must satisfy.",
        "Keep the response focused on the JSON object matching the supplied JSON Schema.",
    ].join("\n"),
} satisfies IPromptOptimizerGuidance;

const MISTRAL_GUIDANCE = {
    source: {
        title: "Mistral prompt engineering best practices",
        url: "https://docs.mistral.ai/models/best-practices/prompt-engineering",
        retrievedAt: RETRIEVED_AT,
    },
    text: [
        "Optimize for Mistral model behavior.",
        "Separate role, task, and constraints with a clear hierarchy and concise wording.",
        "Avoid vague terms, contradictions, and unnecessary output requirements.",
        "For structured outputs, ask only for the necessary fields and require a JSON object matching the supplied JSON Schema.",
    ].join("\n"),
} satisfies IPromptOptimizerGuidance;

const GENERIC_GUIDANCE = {
    source: {
        title: "Flash Evals generic prompt optimization guidance",
        url: "internal://mosaic/prompt-optimization",
        retrievedAt: RETRIEVED_AT,
    },
    text: [
        "Optimize for provider-neutral structured-output reliability.",
        "Clarify the task, expected inputs, output fields, constraints, edge cases, and ambiguity handling.",
        "Preserve schema compatibility and avoid provider-specific wording unless the user explicitly requested it.",
        "Require only a JSON object matching the supplied JSON Schema.",
    ].join("\n"),
} satisfies IPromptOptimizerGuidance;

const PROVIDER_GUIDANCE: Partial<Record<ModelProvider, IPromptOptimizerGuidance>> = {
    openai: OPENAI_GENERAL_GUIDANCE,
    anthropic: CLAUDE_GUIDANCE,
    google: GEMINI_GUIDANCE,
    mistral: MISTRAL_GUIDANCE,
};

export function guidanceForModel(modelId: string): IPromptOptimizerGuidance {
    const normalized = modelId.toLowerCase();
    const registryEntry =
        registryEntryFor(normalized) ?? registryEntryForLiveGatewayModel(normalized);
    const family = registryEntry?.family;
    const bareModelId = registryEntry?.id ?? bareProviderModelId(normalized);
    const provider = registryEntry?.provider;

    if (
        family === "gpt-5" ||
        family === "o-series" ||
        /^gpt-5(?:$|[.-])/.test(bareModelId) ||
        /^o\d/.test(bareModelId)
    ) {
        return GPT_5_GUIDANCE;
    }

    if (family === "gpt-4.1" || /^gpt-4\.1/.test(bareModelId)) {
        return GPT_4_1_GUIDANCE;
    }

    return provider ? PROVIDER_GUIDANCE[provider] ?? GENERIC_GUIDANCE : GENERIC_GUIDANCE;
}

function bareProviderModelId(modelId: string): string {
    const separatorIndex = modelId.indexOf("/");
    return separatorIndex === -1 ? modelId : modelId.slice(separatorIndex + 1);
}
