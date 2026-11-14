import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ISetupComparisonMember } from "@flash-evals/api-contract";
import {
    ComparisonMembers,
    memberHref,
    memberLabel,
    memberNote,
} from "./comparison-members";

const evalRun: ISetupComparisonMember = {
    kind: "eval_run",
    runId: "run-1",
    name: "Eval run",
    status: "running",
    createdAt: "2026-11-06T10:00:00.000Z",
};

const pipeline: ISetupComparisonMember = {
    kind: "pipeline",
    runId: "wf-run-1",
    workflowId: "wf-1",
    name: "Three steps",
    stepModels: ["model-a", "model-b"],
    status: "running",
    createdAt: "2026-11-06T10:00:00.000Z",
    waitingForEvalRun: true,
};

describe("comparison members", () => {
    it("links each member to its own run page", () => {
        expect(memberHref(evalRun)).toBe("/runs/run-1");
        expect(memberHref(pipeline)).toBe("/multiworkflow/wf-1/runs/wf-run-1");
    });

    it("names a pipeline with its steps' models", () => {
        expect(
            memberLabel(pipeline, (id) => (id === "model-a" ? "Model A" : id)),
        ).toBe("Three steps (Model A → model-b)");
    });

    it("says why a member is waiting", () => {
        expect(memberNote(pipeline)).toContain("scored once the eval run");
        expect(
            memberNote({
                ...evalRun,
                status: "pending",
                waitingForWorker: true,
                enqueueStatus: "queued",
            }),
        ).toContain("No worker has picked this run up");
        expect(
            memberNote({ ...evalRun, status: "failed", error: "Bad key" }),
        ).toBe("Failed to start: Bad key");
        expect(memberNote(evalRun)).toBeUndefined();
    });

    it("lists every member with its status", () => {
        render(<ComparisonMembers members={[evalRun, pipeline]} />);
        expect(
            screen.getByRole("link", {
                name: "Three steps (model-a → model-b)",
            }),
        ).toHaveAttribute("href", "/multiworkflow/wf-1/runs/wf-run-1");
        expect(screen.getAllByText("Running")).toHaveLength(2);
    });
});
