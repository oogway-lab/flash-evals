import { describe, expect, it } from "vitest";
import {
    agentCalls,
    audio,
    CLONE_COMMAND,
    DOCS_URL,
    installSteps,
    item,
    leaderboard,
    lineItems,
    MCP_DOCS_URL,
    REPO_URL,
    responses,
    STT_DOCS_URL,
} from "./content";

describe("marketing demo content", () => {
    it("keeps the receipt references aligned with every model response", () => {
        const referenceFields = item.reference.map((field) => field.name);

        expect(responses).toHaveLength(3);
        expect(new Set(responses.map((response) => response.code)).size).toBe(
            responses.length,
        );
        for (const response of responses) {
            expect(response.fields.map((field) => field.name)).toEqual(
                referenceFields,
            );
            expect(Number(response.cost)).toBeGreaterThanOrEqual(0);
        }
        expect(responses.map((response) => response.latencyMs)).toEqual([
            620, 910, 1840,
        ]);
    });

    it("keeps the leaderboard, audio comparison, and agent demo complete", () => {
        expect(leaderboard.map((row) => row.code)).toEqual([
            "A",
            "B",
            "C",
            "D",
        ]);
        expect(audio.variants).toHaveLength(3);
        expect(
            audio.variants.every((variant) => variant.words.length > 0),
        ).toBe(true);
        expect(lineItems.length).toBeGreaterThan(0);
        expect(agentCalls.length).toBeGreaterThan(0);
    });

    it("keeps install and documentation links pointed at the repository", () => {
        expect(REPO_URL).toBe("https://github.com/oogway-lab/flash-evals");
        expect(CLONE_COMMAND).toBe(`git clone ${REPO_URL}`);
        expect(DOCS_URL).toContain(`${REPO_URL}/blob/main/docs/`);
        expect(MCP_DOCS_URL).toContain(`${REPO_URL}/blob/main/docs/`);
        expect(STT_DOCS_URL).toContain(`${REPO_URL}/blob/main/docs/`);
        expect(installSteps).toContain("pnpm run dev");
    });
});
