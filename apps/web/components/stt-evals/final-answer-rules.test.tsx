import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FinalAnswerRules } from "./final-answer-rules";

afterEach(cleanup);

const steps = [{ nodeKey: "extract", label: "Extract" }];

describe("FinalAnswerRules", () => {
    it("adds a rule that sets the field when a step's field matches", () => {
        const onChange = vi.fn();
        const { rerender } = render(
            <FinalAnswerRules
                id="r"
                rules={[]}
                steps={steps}
                onChange={onChange}
            />,
        );
        fireEvent.click(screen.getByText("Set by a rule"));
        fireEvent.click(screen.getByRole("button", { name: /Add rule/ }));
        const added = onChange.mock.lastCall![0];
        expect(added).toEqual([
            {
                when: {
                    stepKey: "extract",
                    path: "",
                    operator: "equals",
                    values: [],
                },
                value: "",
            },
        ]);
        rerender(
            <FinalAnswerRules
                id="r"
                rules={added}
                steps={steps}
                onChange={onChange}
            />,
        );
        fireEvent.change(screen.getByLabelText("Set to"), {
            target: { value: "true" },
        });
        expect(onChange.mock.lastCall![0][0].value).toBe(true);
        fireEvent.change(screen.getByLabelText(/^Is/), {
            target: { value: "non-sales, other" },
        });
        expect(onChange.mock.lastCall![0][0].when).toMatchObject({
            operator: "one_of",
            values: ["non-sales", "other"],
        });
        fireEvent.click(screen.getByLabelText(/Ignore case/));
        expect(onChange.mock.lastCall![0][0].when.ignoreCase).toBe(true);
    });
});
