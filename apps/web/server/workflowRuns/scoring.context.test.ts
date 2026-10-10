import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { IWorkflowSnapshotNode } from "../db/jsonTypes";
import { labels } from "../db/schema";

const mocks = vi.hoisted(() => ({
    from: vi.fn(),
    where: vi.fn(),
}));

vi.mock("../db/client", () => ({
    db: { select: vi.fn(() => ({ from: mocks.from })) },
}));

import { loadWorkflowScoringContext } from "./scoring";

function node(
    nodeType: IWorkflowSnapshotNode["nodeType"],
): IWorkflowSnapshotNode {
    return {
        id: "node-1",
        nodeKey: "node-1",
        label: "Synthetic node",
        nodeType,
        evalConfig: { type: "none" },
    };
}

beforeEach(() => {
    mocks.from.mockReset().mockReturnValue({ where: mocks.where });
    mocks.where.mockReset().mockResolvedValue([
        {
            datasetItemId: "item-1",
            labelJson: { expectedTranscript: "synthetic" },
        },
    ]);
});

describe("loadWorkflowScoringContext label requirements", () => {
    it("batch-loads metric references using only the run's item IDs", async () => {
        const context = await loadWorkflowScoringContext(
            [node("metric_compare")],
            ["item-1", "item-2"],
        );
        expect(context.labelsByItemId.get("item-1")).toEqual({
            expectedTranscript: "synthetic",
        });
        expect(context.labelsByItemId.has("item-2")).toBe(false);
        expect(mocks.from).toHaveBeenCalledExactlyOnceWith(labels);
        expect(mocks.where).toHaveBeenCalledTimes(1);
        expect(
            new PgDialect().sqlToQuery(mocks.where.mock.calls[0][0]).params,
        ).toEqual(["item-1", "item-2"]);
    });

    it("returns an empty map when metric references are absent", async () => {
        mocks.where.mockResolvedValue([]);
        const context = await loadWorkflowScoringContext(
            [node("metric_compare")],
            ["item-1"],
        );
        expect(context.labelsByItemId.size).toBe(0);
        expect(mocks.from).toHaveBeenCalledExactlyOnceWith(labels);
    });

    it("does not query labels for an empty run", async () => {
        const context = await loadWorkflowScoringContext(
            [node("metric_compare")],
            [],
        );
        expect(context.labelsByItemId.size).toBe(0);
        expect(mocks.from).not.toHaveBeenCalled();
    });

    it.each([
        "input",
        "prompt",
        "llm_text",
        "transliterate",
        "judge",
        "stt",
    ] as const)(
        "does not fetch labels for an unevaluated %s node",
        async (nodeType) => {
            const context = await loadWorkflowScoringContext(
                [node(nodeType)],
                ["item-1"],
            );
            expect(context.labelsByItemId.size).toBe(0);
            expect(mocks.from).not.toHaveBeenCalled();
        },
    );

    it("retains field-diff label loading", async () => {
        const context = await loadWorkflowScoringContext(
            [
                {
                    ...node("prompt"),
                    evalConfig: { type: "field_diff", fieldConfigs: [] },
                },
            ],
            ["item-1"],
        );
        expect(context.labelsByItemId.get("item-1")).toEqual({
            expectedTranscript: "synthetic",
        });
        expect(mocks.from).toHaveBeenCalledExactlyOnceWith(labels);
    });

    it("retains explicitly requested transcript labels for audio workflows", async () => {
        const context = await loadWorkflowScoringContext(
            [node("stt")],
            ["item-1"],
            true,
        );
        expect(context.labelsByItemId.get("item-1")).toEqual({
            expectedTranscript: "synthetic",
        });
        expect(mocks.from).toHaveBeenCalledExactlyOnceWith(labels);
    });
});
