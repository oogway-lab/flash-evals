export const REDACTED = "[REDACTED]";

// Order matters: header/field forms first so their whole value is replaced,
// then bare token shapes that can appear anywhere in provider error text.
const REDACTIONS: ReadonlyArray<readonly [RegExp, string]> = [
    // Authorization: Bearer <token> / "authorization":"Basic <token>"
    [
        /(\bauthorization["']?\s*[:=]\s*["']?)(?:bearer|basic|token)?\s*[^\s"',;}]+/gi,
        `$1${REDACTED}`,
    ],
    // Header- or field-style API keys: x-api-key: ..., api_key=..., "apiKey":"..."
    [
        /(\b(?:x-api-key|x-goog-api-key|api[-_]?key|apikey|access[-_]?token|secret[-_]?key|client[-_]?secret|password)["']?\s*[:=]\s*["']?)[^\s"',;&}]+/gi,
        `$1${REDACTED}`,
    ],
    // Query-string keys (?key=... / &token=...)
    [/([?&](?:key|api_key|token|access_token)=)[^&\s"']+/gi, `$1${REDACTED}`],
    // Bare bearer tokens
    [/(\bbearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, `$1${REDACTED}`],
    // Provider key shapes: OpenAI/OpenRouter/Anthropic (sk-...), Vercel AI
    // Gateway (vck_...), Groq (gsk_...), xAI (xai-...), Google (AIza...).
    [/\b(?:sk|vck|gsk)[-_][A-Za-z0-9_-]{8,}/g, REDACTED],
    // xAI keys are one long alphanumeric run; model ids like xai-grok-3-mini
    // are short hyphenated words and must survive.
    [/\bxai-[A-Za-z0-9]{32,}/g, REDACTED],
    [/\bAIza[0-9A-Za-z_-]{20,}/g, REDACTED],
];

/**
 * Replace credentials in free text (error messages, stack traces, provider
 * response bodies) before it is logged or persisted.
 */
export function redactSecrets(text: string): string {
    let redacted = text;
    for (const [pattern, replacement] of REDACTIONS) {
        redacted = redacted.replace(pattern, replacement);
    }
    return redacted;
}

/**
 * Loggable, redacted description of an unknown thrown value: message plus
 * stack (and the cause chain) for errors, `String(value)` otherwise.
 */
export function redactedErrorDetail(err: unknown): string {
    return redactSecrets(errorDetail(err, 0));
}

function errorDetail(err: unknown, depth: number): string {
    if (!(err instanceof Error)) return String(err);
    const own = err.stack ?? `${err.name}: ${err.message}`;
    const cause = (err as Error & { cause?: unknown }).cause;
    if (cause === undefined || depth >= 3) return own;
    return `${own}\nCaused by: ${errorDetail(cause, depth + 1)}`;
}
