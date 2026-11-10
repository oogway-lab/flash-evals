/**
 * Claude models whose API refuses settings other Claude models take, as
 * @ai-sdk/anthropic lists them (`rejectsSamplingParameters`,
 * `rejectsThinkingDisabled`). Over the Gateway, OpenRouter or Bifrost no SDK
 * drops these for us, so the call would fail; Flash Evals leaves them out.
 */

/** A Claude id as the maker spells it: no route prefix, dots as dashes. */
function claudeName(modelId: string): string {
    return modelId
        .slice(modelId.lastIndexOf("/") + 1)
        .toLowerCase()
        .replace(/\./g, "-");
}

/** Claude 5.x and Opus 4.7 / 4.8 refuse temperature and top-p. */
export function claudeRejectsSampling(modelId: string): boolean {
    return /^claude-(?:(?:fable|opus|sonnet|haiku)-5|opus-4-[78])(?:$|[-:@])/.test(
        claudeName(modelId),
    );
}

/** Claude models that can't turn thinking off ("none"). */
export function claudeRejectsThinkingDisabled(modelId: string): boolean {
    return /^claude-(?:sonnet-5-5|opus-5-5|fable-5)(?:$|[-:@])/.test(
        claudeName(modelId),
    );
}
