import { describe, expect, it } from "vitest";
import {
    assembleDagNodeInput,
    assembleNodeInput,
    orderLinearSnapshot,
    planLayers,
} from "./chain";

describe("workflow chain", () => {
    it("orders nodes independently of storage order", () => {
        const ordered = orderLinearSnapshot(
            [{ nodeKey: "c" }, { nodeKey: "a" }, { nodeKey: "b" }],
            [
                { fromNodeKey: "b", toNodeKey: "c", carryOriginalInput: false },
                { fromNodeKey: "a", toNodeKey: "b", carryOriginalInput: false },
            ],
        );
        expect(ordered.map((node) => node.nodeKey)).toEqual(["a", "b", "c"]);
    });

    it("plans a diamond and labels merge inputs while carrying original once", () => {
        const nodes = ["a", "b", "c", "d"].map((nodeKey) => ({ nodeKey }));
        const edges = [
            { fromNodeKey: "a", toNodeKey: "b", carryOriginalInput: false },
            { fromNodeKey: "a", toNodeKey: "c", carryOriginalInput: false },
            { fromNodeKey: "b", toNodeKey: "d", carryOriginalInput: true },
            { fromNodeKey: "c", toNodeKey: "d", carryOriginalInput: true },
        ];
        expect(
            planLayers(nodes, edges).map((layer) =>
                layer.map((node) => node.nodeKey),
            ),
        ).toEqual([["a"], ["b", "c"], ["d"]]);
        expect(
            assembleDagNodeInput(
                "original",
                edges.slice(2),
                new Map([
                    ["b", { nodeKey: "b", label: "Draft", output: "one" }],
                    ["c", { nodeKey: "c", label: "Critique", output: "two" }],
                ]),
            ),
        ).toBe(
            '<from node="Draft">one</from>\n<from node="Critique">two</from>\n<original_input>original</original_input>',
        );
    });

    it("assembles merge inputs in stable source-key order", () => {
        const outputs = new Map([
            ["b", { nodeKey: "b", label: "Draft", output: "one" }],
            ["c", { nodeKey: "c", label: "Critique", output: "two" }],
        ]);
        const reversedEdges = [
            { fromNodeKey: "c", toNodeKey: "d", carryOriginalInput: false },
            { fromNodeKey: "b", toNodeKey: "d", carryOriginalInput: false },
        ];
        expect(assembleDagNodeInput("original", reversedEdges, outputs)).toBe(
            '<from node="Draft">one</from>\n<from node="Critique">two</from>',
        );
    });

    it("only carries original input when enabled", () => {
        expect(assembleNodeInput("original", undefined, false)).toBe(
            "<input>original</input>",
        );
        expect(assembleNodeInput("original", "draft", false)).toBe("draft");
        expect(assembleNodeInput("original", "draft", true)).toBe(
            "<upstream_output>draft</upstream_output>\n<original_input>original</original_input>",
        );
    });

    it("preserves the v1 input contract for a single DAG parent", () => {
        expect(
            assembleDagNodeInput(
                "original",
                [
                    {
                        fromNodeKey: "a",
                        toNodeKey: "b",
                        carryOriginalInput: true,
                    },
                ],
                new Map([
                    ["a", { nodeKey: "a", label: "Draft", output: "draft" }],
                ]),
            ),
        ).toBe(
            "<upstream_output>draft</upstream_output>\n<original_input>original</original_input>",
        );
    });

    it("layers disconnected STT branches only when explicitly allowed", () => {
        const nodes = ["root-a", "child-a", "root-b", "child-b"].map(
            (nodeKey) => ({ nodeKey }),
        );
        const edges = [
            {
                fromNodeKey: "root-a",
                toNodeKey: "child-a",
                carryOriginalInput: false,
            },
            {
                fromNodeKey: "root-b",
                toNodeKey: "child-b",
                carryOriginalInput: false,
            },
        ];
        expect(() => planLayers(nodes, edges)).toThrow("connected");
        expect(
            planLayers(nodes, edges, { allowDisconnected: true }).map((layer) =>
                layer.map((node) => node.nodeKey),
            ),
        ).toEqual([
            ["root-a", "root-b"],
            ["child-a", "child-b"],
        ]);
    });
});
