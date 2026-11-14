import type {
    IWorkflowLlmResolvedExecution,
    IWorkflowLlmTransportConfig,
} from "@flash-evals/api-contract";
import { describe, expect, it } from "vitest";
import { ApiBadRequestError } from "../errors.js";
import { workflowRunConfigFor } from "./workflowRunConfig.js";

function step(label: string, transportConfig: IWorkflowLlmTransportConfig) {
    return {
        label,
        execution: {
            route: { transportConfig },
        } as unknown as IWorkflowLlmResolvedExecution,
    };
}

const gateway = step("Extract", {
    transport: "gateway",
    upstreamPolicy: { mode: "gateway_auto" },
    modelFallback: "disabled",
});
const openRouter = step("Classify", {
    transport: "openrouter",
    upstreamPolicy: { mode: "auto" },
    requireParameters: true,
    responseCache: "disable",
});

describe("workflowRunConfigFor", () => {
    it("keeps no settings for a run without a limit or rules", () => {
        expect(workflowRunConfigFor({}, [gateway])).toEqual({});
        expect(
            workflowRunConfigFor(
                { dataPolicy: { onlyHosts: [], zeroDataRetention: false } },
                [gateway],
            ),
        ).toEqual({});
    });

    it("keeps the limit and the rules gateway steps can follow", () => {
        expect(
            workflowRunConfigFor(
                {
                    maxCostUsd: 12.5,
                    dataPolicy: {
                        onlyHosts: ["vertex"],
                        zeroDataRetention: true,
                    },
                },
                [gateway, openRouter],
            ),
        ).toEqual({
            maxCostUsd: 12.5,
            dataPolicy: { onlyHosts: ["vertex"], zeroDataRetention: true },
        });
    });

    it("refuses rules for a step on a route that can't follow them", () => {
        expect(() =>
            workflowRunConfigFor(
                { dataPolicy: { disallowPromptTraining: true } },
                [gateway, step("Summarize", { transport: "openai" })],
            ),
        ).toThrow(/Summarize runs on OpenAI directly/);
    });

    it("lets a Bifrost step follow the rules only when Bifrost forwards it to OpenRouter", () => {
        const bifrost = (transportModelId: string) => ({
            label: "Points",
            execution: {
                route: {
                    transportConfig: {
                        transport: "bifrost",
                        upstreamPolicy: { mode: "bifrost_default" },
                    },
                },
                capability: { transport: { transportModelId } },
            } as unknown as IWorkflowLlmResolvedExecution,
        });
        const rules = {
            dataPolicy: {
                onlyHosts: ["google-vertex"],
                zeroDataRetention: true,
            },
        };
        expect(
            workflowRunConfigFor(rules, [
                bifrost("openrouter/google/gemini-2.5-flash"),
            ]),
        ).toEqual(rules);
        expect(() =>
            workflowRunConfigFor(rules, [bifrost("gemini/gemini-2.5-flash")]),
        ).toThrow(
            'dataPolicy: Points runs on Bifrost as "gemini/gemini-2.5-flash", which Bifrost sends to gemini rather than OpenRouter',
        );
    });

    it("lets a pinned OpenRouter route run only when its hosts are allowed", () => {
        const pinned = step("Notes", {
            transport: "openrouter",
            upstreamPolicy: { mode: "exact", only: ["together", "fireworks"] },
            requireParameters: true,
            responseCache: "disable",
        });
        expect(() =>
            workflowRunConfigFor({ dataPolicy: { onlyHosts: ["together"] } }, [
                pinned,
            ]),
        ).toThrow(/Notes is pinned to OpenRouter host "fireworks"/);
        expect(
            workflowRunConfigFor(
                { dataPolicy: { onlyHosts: ["together", "fireworks"] } },
                [pinned],
            ),
        ).toEqual({
            dataPolicy: { onlyHosts: ["together", "fireworks"] },
        });
        // Retention rules alone still apply on top of the pin.
        expect(
            workflowRunConfigFor({ dataPolicy: { zeroDataRetention: true } }, [
                pinned,
            ]),
        ).toEqual({ dataPolicy: { zeroDataRetention: true } });
    });

    it("lets a direct maker step run only under an allowed-host list naming the maker", () => {
        const claude = step("Draft", { transport: "anthropic" });
        const gemini = step("Translate", { transport: "google" });
        expect(
            workflowRunConfigFor(
                {
                    dataPolicy: {
                        onlyHosts: ["anthropic", "google-ai-studio"],
                    },
                },
                [gateway, claude, gemini],
            ),
        ).toEqual({
            dataPolicy: { onlyHosts: ["anthropic", "google-ai-studio"] },
        });
        expect(() =>
            workflowRunConfigFor({ dataPolicy: { onlyHosts: ["vertex"] } }, [
                claude,
            ]),
        ).toThrow(
            /Draft runs on Anthropic directly, which can only follow an allowed-host list that includes "anthropic"/,
        );
        // Retention and training rules depend on the account's agreement
        // with the maker, which a direct call can't check.
        for (const dataPolicy of [
            { onlyHosts: ["google"], zeroDataRetention: true },
            { onlyHosts: ["google"], disallowPromptTraining: true },
        ])
            expect(() =>
                workflowRunConfigFor({ dataPolicy }, [gemini]),
            ).toThrow(/Translate runs on Gemini API directly/);
    });

    it("refuses malformed rules and limits", () => {
        expect(() =>
            workflowRunConfigFor({ dataPolicy: { onlyHosts: ["no spaces"] } }, [
                gateway,
            ]),
        ).toThrow(ApiBadRequestError);
        expect(() =>
            workflowRunConfigFor({ maxCostUsd: -1 }, [gateway]),
        ).toThrow("The spend limit must be more than $0");
        expect(() =>
            workflowRunConfigFor({ dataPolicy: "vertex" as never }, [gateway]),
        ).toThrow("dataPolicy must be an object.");
    });
});
