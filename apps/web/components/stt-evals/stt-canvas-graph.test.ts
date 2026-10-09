import { describe, expect, it } from "vitest";
import type { Edge, Node } from "@xyflow/react";
import {
    validateSttGraphConnection,
    type ISttGraphNodeData,
} from "./stt-canvas-graph";

const nodes = [
    ["a", "input"],
    ["a-text", "llm_text"],
    ["b", "input"],
    ["b-text", "llm_text"],
    ["stt", "stt"],
].map(
    ([id, nodeType]) =>
        ({
            id,
            position: { x: 0, y: 0 },
            data: { nodeKey: id, label: id, nodeType },
        }) as Node<ISttGraphNodeData>,
);

describe("STT canvas connection validation", () => {
    it("rejects inbound input connections and cross-root fan-in", () => {
        expect(validateSttGraphConnection(nodes, [], "a-text", "b")).toMatch(
            /input nodes.*roots/i,
        );
        const edges = [
            { source: "a", target: "a-text" },
            { source: "b", target: "b-text" },
        ] as Edge[];
        expect(validateSttGraphConnection(nodes, edges, "b", "a-text")).toMatch(
            /exactly one input root/i,
        );
    });

    it("allows input to feed STT and same-root downstream connections", () => {
        expect(
            validateSttGraphConnection(nodes, [], "a", "stt"),
        ).toBeUndefined();
        expect(
            validateSttGraphConnection(
                nodes,
                [{ source: "a", target: "a-text" }] as Edge[],
                "a",
                "b-text",
            ),
        ).toBeUndefined();
    });

    it("retains self-connection and cycle protection", () => {
        expect(validateSttGraphConnection(nodes, [], "a", "a")).toMatch(
            /cannot connect to itself/i,
        );
        expect(
            validateSttGraphConnection(
                nodes,
                [
                    { source: "a", target: "a-text" },
                    { source: "a-text", target: "b-text" },
                ] as Edge[],
                "b-text",
                "a-text",
            ),
        ).toMatch(/cycle/i);
    });
});
