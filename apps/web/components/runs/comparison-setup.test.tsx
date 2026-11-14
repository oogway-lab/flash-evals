import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type {
    IRunSetupDatasetOption,
    IRunSetupModelOption,
    IRunSetupVersionOption,
} from "@flash-evals/api-contract";
import { pickOption } from "@/components/ui/test-utils";
import { ComparisonSetup } from "./comparison-setup";

beforeAll(() => {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
        class {
            observe() {}
            unobserve() {}
            disconnect() {}
        };
    Element.prototype.hasPointerCapture = vi.fn(() => false);
    Element.prototype.releasePointerCapture = vi.fn();
    Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

function model(
    id: string,
    label: string,
    input: number,
    output: number,
): IRunSetupModelOption {
    return {
        id,
        label,
        family: "x",
        provider: "x",
        providerLabel: "X",
        reasoning: false,
        vision: false,
        structuredOutput: true,
        judgeSuitable: true,
        costAvailable: true,
        available: true,
        transports: ["gateway"],
        providers: [
            {
                transport: "gateway",
                modelId: id,
                inputPerMillion: input,
                outputPerMillion: output,
                keySaved: true,
            },
        ],
    };
}

const DATASETS: IRunSetupDatasetOption[] = [
    {
        id: "ds-1",
        name: "Sample calls",
        itemCount: 100,
        labeledItemCount: 0,
        purpose: "evaluation",
        modality: "text",
        avgInputChars: 15_000,
    },
];

const VERSIONS: IRunSetupVersionOption[] = [
    {
        id: "pv-1",
        label: "Extraction v1",
        fieldConfigs: [],
        promptChars: 15_000,
        outputSchema: {
            type: "object",
            properties: {
                domain: { type: "string", enum: ["Sales", "Non-Sales"] },
            },
            required: ["domain"],
            additionalProperties: false,
        },
    },
];

const MODELS = [
    model("sonnet", "Claude Sonnet 5.5", 2, 10),
    model("luna", "GPT-6 Luna", 0.1, 0.5),
];

function hidden(container: HTMLElement, name: string): string {
    return (
        (
            container.querySelector(
                `input[name="${name}"]`,
            ) as HTMLInputElement | null
        )?.value ?? ""
    );
}

describe("ComparisonSetup", () => {
    it("walks the four steps and submits today's model, the candidates and a pilot", () => {
        const { container } = render(
            <ComparisonSetup
                datasets={DATASETS}
                versionOptions={VERSIONS}
                availableModels={MODELS}
                savedKeyProviders={["gateway"]}
                createRunAction={vi.fn(async () => ({}))}
            />,
        );
        // Step 1: today's model.
        fireEvent.click(screen.getAllByLabelText(/Claude Sonnet 5\.5/)[0]!);
        fireEvent.click(
            screen.getAllByRole("button", { name: "Continue" })[0]!,
        );
        // Step 2: tasks drafted from the output schema.
        expect(screen.getByText("Domain")).toBeInTheDocument();
        // Compared with today's model's answers: the fixed minimum.
        expect(screen.getByText("90%+")).toBeInTheDocument();
        fireEvent.click(
            screen.getAllByRole("button", { name: "Continue" })[0]!,
        );
        // Step 3: a candidate, with its estimated cost per call.
        fireEvent.click(screen.getAllByLabelText(/GPT-6 Luna/).at(-1)!);
        expect(
            screen.getAllByText(/≈ \$0\.0015 per call · 5% of today's model/)
                .length,
        ).toBeGreaterThan(0);
        fireEvent.click(
            screen.getAllByRole("button", { name: "Continue" })[0]!,
        );

        expect(hidden(container, "referenceModel")).toBe("sonnet");
        expect(hidden(container, "models")).toBe("sonnet\nluna");
        expect(hidden(container, "itemLimit")).toBe("20");
        expect(hidden(container, "maxTokens")).toBe("8000");
        expect(JSON.parse(hidden(container, "transportAssignments"))).toEqual([
            { modelId: "sonnet", transport: "gateway" },
            { modelId: "luna", transport: "gateway" },
        ]);
        expect(
            JSON.parse(hidden(container, "benchmark")).taskMap.tasks,
        ).toHaveLength(1);
        expect(
            screen.getByRole("button", {
                name: "Start the pilot (20 transcripts)",
            }),
        ).toBeEnabled();
        // 20 calls each: Sonnet 20 × $0.03, Luna 20 × $0.0015.
        expect(screen.getByLabelText("Estimated cost")).toHaveTextContent(
            "≈ $0.63",
        );
    });

    it("offers saved pipelines on the dataset and submits the chosen ones", () => {
        const { container } = render(
            <ComparisonSetup
                datasets={DATASETS}
                versionOptions={VERSIONS}
                availableModels={MODELS}
                pipelines={[
                    {
                        id: "chain-1",
                        name: "Three steps",
                        kind: "multi",
                        datasetId: "ds-1",
                        hasFinalAnswer: true,
                        steps: [
                            {
                                label: "Extract",
                                modelId: "luna",
                                transport: "gateway",
                                promptChars: 3_000,
                            },
                        ],
                    },
                    {
                        id: "chain-2",
                        name: "No answer yet",
                        kind: "multi",
                        datasetId: "ds-1",
                        hasFinalAnswer: false,
                        steps: [],
                        unavailableReason:
                            "No final answer yet. Add one under the canvas to compare it.",
                    },
                    {
                        id: "chain-3",
                        name: "Other dataset",
                        kind: "multi",
                        datasetId: "ds-2",
                        hasFinalAnswer: true,
                        steps: [],
                    },
                ]}
                createRunAction={vi.fn(async () => ({}))}
            />,
        );
        fireEvent.click(screen.getAllByLabelText(/Claude Sonnet 5\.5/)[0]!);
        fireEvent.click(
            screen.getAllByRole("button", { name: "Continue" })[0]!,
        );
        fireEvent.click(
            screen.getAllByRole("button", { name: "Continue" })[0]!,
        );
        // Step 3: the pipeline is named with its steps' models.
        expect(screen.queryByText(/Other dataset/)).not.toBeInTheDocument();
        expect(screen.getByLabelText(/No answer yet/)).toBeDisabled();
        fireEvent.click(screen.getByLabelText(/Three steps \(GPT-6 Luna\)/));
        // A pipeline alone is enough to continue.
        fireEvent.click(
            screen.getAllByRole("button", { name: "Continue" })[0]!,
        );

        expect(hidden(container, "comparisonPipelineId")).toBe("chain-1");
        expect(hidden(container, "models")).toBe("sonnet");
        expect(screen.getByLabelText("Estimated cost")).toHaveTextContent(
            /Three steps/,
        );
        expect(screen.getByLabelText("Estimated cost")).toHaveTextContent(
            /Time: about \d+ minutes?, roughly\./,
        );
    });

    it("can't continue from step 1 without today's model", () => {
        render(
            <ComparisonSetup
                datasets={DATASETS}
                versionOptions={VERSIONS}
                availableModels={MODELS}
                createRunAction={vi.fn(async () => ({}))}
            />,
        );
        expect(
            screen.getAllByRole("button", { name: "Continue" })[0],
        ).toBeDisabled();
    });

    describe("with a label filter", () => {
        function startWithFilter(matching: number) {
            const count = vi.fn(async () => ({
                ok: true as const,
                matching,
                total: 100,
            }));
            const view = render(
                <ComparisonSetup
                    datasets={DATASETS}
                    versionOptions={VERSIONS}
                    availableModels={MODELS}
                    savedKeyProviders={["gateway"]}
                    createRunAction={vi.fn(async () => ({}))}
                    countItemFilterAction={count}
                />,
            );
            fireEvent.click(screen.getAllByLabelText(/Claude Sonnet 5\.5/)[0]!);
            fireEvent.click(
                screen.getAllByRole("button", { name: "Continue" })[0]!,
            );
            fireEvent.click(
                screen.getAllByRole("button", { name: "Continue" })[0]!,
            );
            fireEvent.click(screen.getAllByLabelText(/GPT-6 Luna/).at(-1)!);
            fireEvent.click(
                screen.getAllByRole("button", { name: "Continue" })[0]!,
            );
            fireEvent.click(screen.getByLabelText("Task"));
            pickOption(screen.getByRole("option", { name: "Domain" }));
            fireEvent.change(screen.getByLabelText("Label equals"), {
                target: { value: " Sales " },
            });
            return { ...view, count };
        }

        it("estimates only the items the filter keeps", async () => {
            const { container, count } = startWithFilter(5);
            await waitFor(() =>
                expect(
                    screen.getByLabelText("Estimated cost"),
                ).toHaveTextContent(
                    'Only transcripts labelled "Sales" for Domain: 5 of 100.',
                ),
            );
            expect(count).toHaveBeenLastCalledWith("ds-1", "$.domain", "Sales");
            // 5 calls each: Sonnet 5 × $0.03, Luna 5 × $0.0015.
            expect(screen.getByLabelText("Estimated cost")).toHaveTextContent(
                "≈ $0.16",
            );
            expect(hidden(container, "itemLimit")).toBe("5");
            expect(
                screen.getByRole("button", {
                    name: "Start the pilot (5 transcripts)",
                }),
            ).toBeEnabled();
        });

        it("says a filter that keeps nothing would be refused, and can't start", async () => {
            startWithFilter(0);
            await waitFor(() =>
                expect(
                    screen.getByLabelText("Estimated cost"),
                ).toHaveTextContent(
                    'No transcript is labelled "Sales" for Domain, so the run would be refused.',
                ),
            );
            expect(screen.getByLabelText("Estimated cost")).toHaveTextContent(
                "≈ $0",
            );
            expect(
                screen.getByRole("button", { name: /Start the pilot/ }),
            ).toBeDisabled();
        });
    });
});
