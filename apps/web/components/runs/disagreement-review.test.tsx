import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { IRunDisagreementsResponse } from "@flash-evals/api-contract";
import {
    DisagreementReview,
    listDifference,
    showValue,
    yardstickName,
} from "./disagreement-review";

beforeAll(() => {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
        class {
            observe() {}
            unobserve() {}
            disconnect() {}
        };
});
afterEach(cleanup);

const DATA: IRunDisagreementsResponse = {
    runModelId: "rm-luna",
    modelId: "gpt-6-luna",
    taskKey: "products",
    taskName: "Products",
    method: "agreement",
    yardstick: "model",
    referenceModelId: "anthropic/claude-sonnet-5.5",
    compared: 20,
    disagreements: [
        {
            cellId: "cell-1",
            itemId: "item-1",
            inputText: "transcript one",
            fields: [
                {
                    path: "$.product",
                    matcher: "set_overlap",
                    score: 0.5,
                    candidate: ["Acme Salt", "Cashew"],
                    benchmark: ["Acme Salt"],
                },
            ],
            decisions: [],
        },
    ],
};

const TARGET = {
    runModelId: "rm-luna",
    taskKey: "products",
    modelName: "GPT-6 Luna",
    taskName: "Products",
};

describe("disagreement helpers", () => {
    it("shows values plainly", () => {
        expect(showValue(["a", "b"])).toBe("a, b");
        expect(showValue([])).toBe("(none)");
        expect(showValue(null)).toBe("(none)");
    });

    it("says what only one side of a list has, ignoring case", () => {
        expect(
            listDifference(["Acme Salt", "Cashew"], ["acme salt", "Besan"]),
        ).toEqual({
            onlyCandidate: ["Cashew"],
            onlyBenchmark: ["Besan"],
        });
        expect(listDifference("Sales", "Non-Sales")).toBeUndefined();
    });

    it("names the yardstick", () => {
        expect(yardstickName({ yardstick: "labels" }, "Sonnet")).toBe(
            "The stored answer",
        );
        expect(yardstickName({ yardstick: "model" }, "Claude Sonnet 5.5")).toBe(
            "Claude Sonnet 5.5",
        );
    });
});

describe("DisagreementReview", () => {
    it("loads the transcripts behind a cell and records who was right", async () => {
        const loadAction = vi.fn(async () => ({
            ok: true as const,
            data: DATA,
        }));
        const decideAction = vi.fn(async () => ({
            ok: true as const,
            newValue: ["Acme Salt", "Cashew"],
        }));
        render(
            <DisagreementReview
                runId="run-1"
                target={TARGET}
                referenceName="Claude Sonnet 5.5"
                onClose={() => undefined}
                loadAction={loadAction}
                decideAction={decideAction}
            />,
        );
        expect(
            await screen.findByText(
                "1 of 20 transcripts differ from Claude Sonnet 5.5's answers.",
            ),
        ).toBeInTheDocument();
        expect(loadAction).toHaveBeenCalledWith({
            runId: "run-1",
            runModelId: "rm-luna",
            taskKey: "products",
        });
        expect(screen.getByText("Only GPT-6 Luna: Cashew")).toBeInTheDocument();
        fireEvent.click(
            screen.getByRole("button", { name: "GPT-6 Luna is right" }),
        );
        await waitFor(() =>
            expect(
                screen.getByText("Saved as the stored answer."),
            ).toBeInTheDocument(),
        );
        expect(decideAction).toHaveBeenCalledWith({
            runId: "run-1",
            cellId: "cell-1",
            taskKey: "products",
            path: "$.product",
            choice: "candidate",
        });
        expect(
            screen.getByRole("button", { name: "GPT-6 Luna is right" }),
        ).toHaveAttribute("aria-pressed", "true");
    });

    it("shows a saving error and keeps the choice open", async () => {
        render(
            <DisagreementReview
                runId="run-1"
                target={TARGET}
                referenceName="Claude Sonnet 5.5"
                onClose={() => undefined}
                loadAction={async () => ({ ok: true, data: DATA })}
                decideAction={async () => ({
                    ok: false,
                    error: "Not allowed.",
                })}
            />,
        );
        fireEvent.click(
            await screen.findByRole("button", {
                name: "Claude Sonnet 5.5 is right",
            }),
        );
        expect(await screen.findByText("Not allowed.")).toBeInTheDocument();
        expect(
            screen.getByRole("button", { name: "Claude Sonnet 5.5 is right" }),
        ).toHaveAttribute("aria-pressed", "false");
    });
});
