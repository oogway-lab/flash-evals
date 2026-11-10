import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { IPipelineComparisonRunOption } from "@flash-evals/api-contract";
import { pickOption } from "@/components/ui/test-utils";
import { CompareRunField, comparisonRunLabel } from "./compare-run-field";

afterEach(cleanup);
beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn();
});

const runs: IPipelineComparisonRunOption[] = [
    {
        id: "aaaaaaaa-0000-4000-8000-000000000001",
        datasetId: "calls",
        status: "completed",
        createdAt: "2026-11-01T10:00:00.000Z",
        noteTitle: "Acme snacks baseline",
        referenceModelId: "openai/big-model",
        taskCount: 3,
    },
    {
        id: "bbbbbbbb-0000-4000-8000-000000000002",
        datasetId: "other",
        status: "partial",
        createdAt: "2026-11-02T10:00:00.000Z",
        taskCount: 1,
    },
];

function hidden(container: HTMLElement): string | undefined {
    return container.querySelector<HTMLInputElement>(
        'input[name="compareWithRunId"]',
    )?.value;
}

describe("CompareRunField", () => {
    it("names a run by its note, reference, tasks and date", () => {
        expect(comparisonRunLabel(runs[0]!)).toMatch(
            /^Acme snacks baseline · reference openai\/big-model · 3 tasks · /,
        );
        expect(comparisonRunLabel(runs[1]!)).toMatch(
            /^Run bbbbbbbb · stored answers · 1 task · /,
        );
    });

    it("lists the dataset's runs and submits the chosen one", () => {
        const { container } = render(
            <CompareRunField runs={runs} datasetId="calls" hasFinalAnswer />,
        );
        expect(hidden(container)).toBe("");
        expect(
            screen.getByText(/Task Map, targets, judge and data rules/),
        ).toBeInTheDocument();
        fireEvent.click(
            screen.getByLabelText("Compare with an eval run (optional)"),
        );
        expect(screen.queryByRole("option", { name: /Run bbbbbbbb/ })).toBe(
            null,
        );
        pickOption(
            screen.getByRole("option", { name: /Acme snacks baseline/ }),
        );
        expect(hidden(container)).toBe(runs[0]!.id);
    });

    it("is disabled and says why without a final answer", () => {
        const { container } = render(
            <CompareRunField
                runs={runs}
                datasetId="calls"
                hasFinalAnswer={false}
            />,
        );
        expect(
            screen.getByLabelText("Compare with an eval run (optional)"),
        ).toBeDisabled();
        expect(
            screen.getByText(/Add a final answer under the canvas/),
        ).toBeInTheDocument();
        expect(hidden(container)).toBe("");
    });

    it("says when no run on the dataset can be compared with", () => {
        render(
            <CompareRunField runs={runs} datasetId="empty" hasFinalAnswer />,
        );
        expect(
            screen.getByText(/No finished eval run on this dataset/),
        ).toBeInTheDocument();
    });
});
