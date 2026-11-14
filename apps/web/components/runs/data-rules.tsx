"use client";

import { useState } from "react";
import type { IRunDataPolicy } from "@flash-evals/api-contract";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * "vertex, vertexAnthropic ,bedrock" -> ["vertex", "vertexAnthropic", "bedrock"].
 * Case is kept: gateways' host names are case-sensitive.
 */
export function parseHostList(text: string): string[] {
    return [
        ...new Set(
            text
                .split(/[\s,]+/)
                .map((host) => host.trim())
                .filter(Boolean),
        ),
    ];
}

/** The rules the form describes, or undefined when none is set. */
export function dataPolicyFrom(state: {
    hosts: string;
    zeroDataRetention: boolean;
    disallowPromptTraining: boolean;
}): IRunDataPolicy | undefined {
    const onlyHosts = parseHostList(state.hosts);
    const policy: IRunDataPolicy = {
        ...(onlyHosts.length > 0 ? { onlyHosts } : {}),
        ...(state.zeroDataRetention ? { zeroDataRetention: true } : {}),
        ...(state.disallowPromptTraining
            ? { disallowPromptTraining: true }
            : {}),
    };
    return Object.keys(policy).length > 0 ? policy : undefined;
}

/**
 * Who may serve the run's model and judge calls, and what they may keep.
 * Vercel AI Gateway and OpenRouter route each call to a hosting company;
 * these rules restrict which ones, and every result names the one that
 * served it.
 */
export function DataRules({
    initial,
    variant = "eval",
}: {
    initial?: IRunDataPolicy;
    /** A pipeline run's rules cover its steps and the judges that score them. */
    variant?: "eval" | "pipeline";
}) {
    const [hosts, setHosts] = useState(initial?.onlyHosts?.join(", ") ?? "");
    const [zeroDataRetention, setZeroDataRetention] = useState(
        Boolean(initial?.zeroDataRetention),
    );
    const [disallowPromptTraining, setDisallowPromptTraining] = useState(
        Boolean(initial?.disallowPromptTraining),
    );
    const policy = dataPolicyFrom({
        hosts,
        zeroDataRetention,
        disallowPromptTraining,
    });
    return (
        <fieldset className="flex flex-col gap-3">
            <legend className="text-label-14 text-foreground">
                Data rules (optional)
            </legend>
            {variant === "pipeline" ? (
                <p className="text-copy-14 text-muted-foreground">
                    Vercel AI Gateway and OpenRouter send each call to a hosting
                    company. These rules limit which ones can serve this
                    run&apos;s steps and the judges that score them; a call no
                    allowed host can serve fails rather than going elsewhere.
                    Every step shows the host that served it. Steps on Anthropic
                    or the Gemini API directly are served by the maker, so they
                    run only when the hosts list names it (&quot;anthropic&quot;
                    or &quot;google&quot;) and no other rule is set. Steps on an
                    OpenAI or Bifrost route can&apos;t follow them, so the run
                    won&apos;t start. Calls reuse only results stored under the
                    same rules.
                </p>
            ) : (
                <p className="text-copy-14 text-muted-foreground">
                    Vercel AI Gateway and OpenRouter send each call to a hosting
                    company. These rules limit which ones can serve this
                    run&apos;s models and judge; a call no allowed host can
                    serve fails rather than going elsewhere. Every result shows
                    the host that served it. Models on Anthropic or the Gemini
                    API directly are served by the maker, so they run only when
                    the hosts list names it (&quot;anthropic&quot; or
                    &quot;google&quot;) and no other rule is set. Models on
                    OpenAI or Bifrost directly can&apos;t follow them. Saved
                    answers are reused only from runs with the same rules.
                </p>
            )}
            <input
                type="hidden"
                name="dataPolicy"
                value={policy ? JSON.stringify(policy) : ""}
            />
            <div className="flex flex-col gap-2">
                <Label htmlFor="dataRulesHosts">
                    Only these hosting companies
                </Label>
                <Input
                    id="dataRulesHosts"
                    value={hosts}
                    onChange={(event) => setHosts(event.target.value)}
                    placeholder="Any host. Vercel names, e.g. vertex, bedrock, anthropic"
                />
                <p className="text-label-12 text-muted-foreground">
                    Comma-separated, in the provider&apos;s own names (case
                    matters): Vercel uses vertex, vertexAnthropic, bedrock,
                    anthropic, openai, meta, azure, togetherai, fireworks,
                    parasail…; OpenRouter uses google-vertex, amazon-bedrock,
                    together, fireworks…
                </p>
            </div>
            <label className="flex items-center gap-2 text-copy-14">
                <Checkbox
                    checked={zeroDataRetention}
                    onChange={(event) =>
                        setZeroDataRetention(event.target.checked)
                    }
                />
                Only hosts with zero data retention
            </label>
            <label className="flex items-center gap-2 text-copy-14">
                <Checkbox
                    checked={disallowPromptTraining}
                    onChange={(event) =>
                        setDisallowPromptTraining(event.target.checked)
                    }
                />
                Only hosts that don&apos;t train on prompts
            </label>
        </fieldset>
    );
}
