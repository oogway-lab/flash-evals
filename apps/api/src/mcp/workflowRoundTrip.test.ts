import { describe, expect, it } from "vitest";
import { WorkflowNodeInput } from "./schemas.js";

/**
 * The write schema must accept a node exactly as `get_workflow` returns it.
 * An agent's natural loop is read -> edit -> write, and every field the read
 * emits but the write rejects breaks it. Three separate fields have done so.
 */
describe("MCP workflow node round trip", () => {
    const asRead = {
        id: "9f1d0b4a-1f2a-4c3d-8e5f-6a7b8c9d0e1f",
        workflowId: "1a2b3c4d-5e6f-4a8b-9c0d-1e2f3a4b5c6d",
        nodeKey: "stt-1",
        label: "STT 1",
        nodeType: "stt" as const,
        nodeConfig: {
            type: "stt" as const,
            sttConfig: { modelId: "soniox:stt-async-v5" },
        },
        evalConfig: { type: "none" as const },
        position: { x: 40, y: 40 },
    };

    it("accepts a node shaped exactly as the read returns it", () => {
        expect(WorkflowNodeInput.safeParse(asRead).success).toBe(true);
    });

    it("ignores the read-only identity fields rather than rejecting them", () => {
        const parsed = WorkflowNodeInput.parse(asRead) as Record<
            string,
            unknown
        >;
        expect(parsed.nodeKey).toBe("stt-1");
        // Accepted on the way in, never treated as writable.
        expect(parsed.id ?? undefined).toBeDefined();
    });

    it("still rejects a model on a node type that forbids one", () => {
        // The strictness that surfaced the asymmetry must survive the fix.
        const withModel = { ...asRead, modelId: "soniox:stt-async-v5" };
        expect(WorkflowNodeInput.safeParse(withModel).success).toBe(false);
    });

    it("rejects a null where the contract says the field is absent", () => {
        // SQL NULL reaching the write path is the bug this guards; the read
        // omits these, and the schema must not quietly accept them either.
        const withNulls = { ...asRead, reasoningConfig: null };
        expect(WorkflowNodeInput.safeParse(withNulls).success).toBe(false);
    });

    it.each([
        { mode: "project_default" as const },
        {
            mode: "pinned_route" as const,
            routeVersionId: "55555555-5555-4555-8555-555555555555",
        },
    ])("preserves canonical LLM selection $mode", (llmExecutionSelection) => {
        const node = {
            id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            workflowId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            nodeKey: "llm-1",
            label: "LLM",
            nodeType: "llm_text" as const,
            nodeConfig: { type: "llm_text" as const, promptText: "Summarize" },
            modelId: "openai/gpt-4o",
            llmExecutionSelection,
            evalConfig: { type: "none" as const },
        };

        expect(WorkflowNodeInput.parse(node)).toEqual(node);
    });

    it("rejects LLM route selection on a non-model node", () => {
        expect(
            WorkflowNodeInput.safeParse({
                ...asRead,
                llmExecutionSelection: { mode: "project_default" },
            }).success,
        ).toBe(false);
    });
});
