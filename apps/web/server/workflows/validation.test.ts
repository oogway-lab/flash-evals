import { describe, expect, it } from "vitest";
import { validateWorkflowGraph } from "./validation";

const nodes = ["a", "b", "c"].map((nodeKey) => ({ nodeKey }));
const edge = (fromNodeKey: string, toNodeKey: string) => ({
    fromNodeKey,
    toNodeKey,
});

describe("validateWorkflowGraph", () => {
    it("orders a linear chain", () => {
        expect(
            validateWorkflowGraph(nodes, [edge("a", "b"), edge("b", "c")]),
        ).toEqual({
            ok: true,
            orderedNodeKeys: ["a", "b", "c"],
            layers: [["a"], ["b"], ["c"]],
        });
    });

    it("accepts and layers a diamond DAG", () => {
        const result = validateWorkflowGraph(
            ["a", "b", "c", "d"].map((nodeKey) => ({ nodeKey })),
            [edge("a", "b"), edge("a", "c"), edge("b", "d"), edge("c", "d")],
        );
        expect(result).toEqual({
            ok: true,
            orderedNodeKeys: ["a", "b", "c", "d"],
            layers: [["a"], ["b", "c"], ["d"]],
        });
    });

    it.each([
        ["cycle", [edge("a", "b"), edge("b", "a")]],
        ["self-loop", [edge("a", "a"), edge("a", "b"), edge("b", "c")]],
        ["disconnected", [edge("a", "b")]],
    ])("rejects a %s", (_name, edges) => {
        const result = validateWorkflowGraph(nodes, edges);
        expect(result.ok).toBe(false);
    });

    it("rejects duplicate directed edges", () => {
        expect(
            validateWorkflowGraph(nodes, [edge("a", "b"), edge("a", "b")]),
        ).toEqual({
            ok: false,
            error: "Duplicate directed workflow edges are not allowed.",
        });
    });
});
