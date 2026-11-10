import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { RunAnswer } from "./run-answer";
import type { IModelResult, IRunAnswer } from "./run-results";

afterEach(cleanup);

const model = (overrides: Partial<IModelResult>): IModelResult => ({
    runModelId: "rm",
    modelId: "m",
    name: "M",
    isReference: false,
    failedCells: 0,
    cells: 20,
    ...overrides,
});

const REFERENCE = model({
    runModelId: "rm-big",
    name: "Big Model",
    isReference: true,
    costPerCall: 0.04,
});
const PICK = model({
    runModelId: "rm-small",
    name: "Small Model",
    costPerCall: 0.002,
    relativeCost: 0.05,
});

const ANSWER: IRunAnswer = {
    sentence:
        "No model can replace Big Model yet. Small Model is the closest, at 5% of the cost.",
    sample: {
        label: "Small sample",
        detail: "12 items compared. Results on fewer than 20 items are uncertain.",
    },
    reasons: ["Tags: could be either side of target 90%."],
    pick: PICK,
    pickLabel: "Closest replacement",
    verdict: "conditional",
    pickDetail: "0 of 3 tasks pass",
    reference: REFERENCE,
};

describe("RunAnswer", () => {
    it("leads with the sentence, the sample note and the reasons", () => {
        render(<RunAnswer answer={ANSWER} />);
        const region = screen.getByRole("region", { name: "The answer" });
        expect(region.textContent).toContain(ANSWER.sentence);
        expect(region.textContent).toContain("Small sample");
        expect(region.textContent).toContain("Tags: could be either side");
        expect(
            screen.getByLabelText("Benchmark verdict status: Conditional"),
        ).toBeInTheDocument();
        expect(region.textContent).toContain("Cost against Big Model");
        expect(region.textContent).toContain("$0.0020 vs $0.0400 per call");
    });

    it("projects a monthly saving at the calls the reader enters", () => {
        render(<RunAnswer answer={ANSWER} />);
        expect(screen.getByText("$3,800 a month saved")).toBeInTheDocument();
        fireEvent.change(screen.getByLabelText("Calls per month"), {
            target: { value: "1000" },
        });
        expect(screen.getByText("$38.00 a month saved")).toBeInTheDocument();
    });

    it("says what switching would add when the pick costs more", () => {
        render(
            <RunAnswer
                answer={{
                    ...ANSWER,
                    pick: { ...PICK, costPerCall: 0.05, relativeCost: 1.25 },
                }}
            />,
        );
        expect(screen.getByText("$1,000 a month more")).toBeInTheDocument();
    });

    it("shows only the sentence when there is no model to name", () => {
        render(
            <RunAnswer
                answer={{
                    sentence: "Scores appear as cells finish.",
                    reasons: [],
                    pickLabel: "Leading model",
                }}
            />,
        );
        expect(screen.queryByLabelText("Calls per month")).toBeNull();
        expect(
            screen.getByText("Scores appear as cells finish."),
        ).toBeInTheDocument();
    });
});
