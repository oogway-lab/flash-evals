import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { IRunSetupVersionOption } from "@flash-evals/api-contract";
import { formatCostColumn } from "@/lib/format";
import { pickOption } from "@/components/ui/test-utils";
import { FinalAnswerBlock } from "./final-answer-block";
import { FinalAnswerFields, fieldsFromSchema } from "./final-answer-fields";

afterEach(cleanup);
beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn();
});

const steps = [
    { nodeKey: "extract", label: "Extract" },
    { nodeKey: "notes", label: "Notes" },
];
const versions: IRunSetupVersionOption[] = [
    {
        id: "pv-big",
        label: "Call write-up v3",
        fieldConfigs: [],
        outputSchema: {
            type: "object",
            properties: {
                product: { type: "string" },
                mom: { type: "string" },
            },
        },
    },
    { id: "pv-plain", label: "Plain v1", fieldConfigs: [] },
];

describe("FinalAnswerFields", () => {
    it("starts a final answer, maps a field to a step and picks a schema", () => {
        const onChange = vi.fn();
        const { rerender } = render(
            <FinalAnswerFields
                value={undefined}
                steps={steps}
                versions={versions}
                onChange={onChange}
            />,
        );
        fireEvent.click(
            screen.getByRole("button", { name: "Add final answer" }),
        );
        expect(onChange).toHaveBeenLastCalledWith({
            fields: [{ path: "", stepKey: "", stepPath: "" }],
        });

        const value = { fields: [{ path: "", stepKey: "", stepPath: "" }] };
        rerender(
            <FinalAnswerFields
                value={value}
                steps={steps}
                versions={versions}
                onChange={onChange}
            />,
        );
        fireEvent.change(screen.getByLabelText("Field"), {
            target: { value: "$.mom" },
        });
        expect(onChange).toHaveBeenLastCalledWith({
            fields: [{ path: "$.mom", stepKey: "", stepPath: "" }],
        });
        fireEvent.click(screen.getByLabelText("From step"));
        pickOption(screen.getByRole("option", { name: "Notes" }));
        expect(onChange).toHaveBeenLastCalledWith({
            fields: [{ path: "", stepKey: "notes", stepPath: "" }],
        });
        // Only versions with an output schema are offered.
        fireEvent.click(
            screen.getByLabelText("Check against the output schema of"),
        );
        expect(screen.queryByRole("option", { name: "Plain v1" })).toBeNull();
        pickOption(screen.getByRole("option", { name: "Call write-up v3" }));
        expect(onChange).toHaveBeenLastCalledWith({
            ...value,
            schemaPromptVersionId: "pv-big",
        });
    });

    it("lists a schema's top-level fields", () => {
        expect(fieldsFromSchema(versions[0]!.outputSchema)).toEqual([
            { path: "$.product", stepKey: "", stepPath: "$.product" },
            { path: "$.mom", stepKey: "", stepPath: "$.mom" },
        ]);
        expect(fieldsFromSchema(undefined)).toEqual([]);
    });
});

describe("FinalAnswerBlock", () => {
    const fmtCost = formatCostColumn([0.004]);

    it("shows the answer, its cost and where it misses the schema", () => {
        render(
            <FinalAnswerBlock
                fmtCost={fmtCost}
                answer={{
                    datasetItemId: "item-1",
                    status: "complete",
                    answer: { product: "crisps" },
                    schemaErrors: [
                        {
                            path: "$",
                            message: "must have required property 'mom'",
                        },
                    ],
                    costUsd: 0.004,
                }}
            />,
        );
        expect(screen.getByText(/"product": "crisps"/)).toBeInTheDocument();
        expect(
            screen.getByText("Doesn't match the schema"),
        ).toBeInTheDocument();
        expect(
            screen.getByText("must have required property 'mom'"),
        ).toBeInTheDocument();
        expect(screen.getByLabelText("Final answer")).toHaveTextContent(
            /\$0\.0040* for all steps/,
        );
    });

    it("shows the score against the compared run's reference", () => {
        render(
            <FinalAnswerBlock
                fmtCost={fmtCost}
                answer={{
                    datasetItemId: "item-1",
                    status: "complete",
                    answer: { product: "crisps" },
                    costUsd: 0.004,
                    benchmarkScore: 0.75,
                    judgeCostUsd: 0.002,
                }}
            />,
        );
        expect(screen.getByLabelText("Final answer")).toHaveTextContent(
            /Score against the reference 0\.75 \(judging \$0\.0020*\)/,
        );
    });

    it("waits for the steps to finish", () => {
        render(<FinalAnswerBlock fmtCost={fmtCost} answer={undefined} />);
        expect(
            screen.getByText(
                "Appears when every step for this item has finished.",
            ),
        ).toBeInTheDocument();
    });
});
