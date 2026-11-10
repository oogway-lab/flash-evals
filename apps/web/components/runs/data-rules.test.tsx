import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DataRules, dataPolicyFrom, parseHostList } from "./data-rules";

afterEach(cleanup);

describe("data rules", () => {
    it("reads a host list loosely and drops duplicates", () => {
        expect(
            parseHostList(" vertex, vertexAnthropic ,vertex anthropic"),
        ).toEqual(["vertex", "vertexAnthropic", "anthropic"]);
    });

    it("sends nothing when no rule is set", () => {
        expect(
            dataPolicyFrom({
                hosts: " ",
                zeroDataRetention: false,
                disallowPromptTraining: false,
            }),
        ).toBeUndefined();
    });

    it("puts the rules in the form as JSON", () => {
        const { container } = render(<DataRules />);
        fireEvent.change(
            screen.getByLabelText("Only these hosting companies"),
            {
                target: { value: "vertex, bedrock" },
            },
        );
        fireEvent.click(
            screen.getByLabelText("Only hosts with zero data retention"),
        );
        const hidden = container.querySelector(
            'input[name="dataPolicy"]',
        ) as HTMLInputElement;
        expect(JSON.parse(hidden.value)).toEqual({
            onlyHosts: ["vertex", "bedrock"],
            zeroDataRetention: true,
        });
    });

    it("restores a rerun's rules", () => {
        render(
            <DataRules
                initial={{
                    onlyHosts: ["vertex"],
                    disallowPromptTraining: true,
                }}
            />,
        );
        expect(
            screen.getByLabelText("Only these hosting companies"),
        ).toHaveValue("vertex");
        expect(
            screen.getByLabelText("Only hosts that don't train on prompts"),
        ).toBeChecked();
    });

    it("explains the rules in pipeline terms for a pipeline run", () => {
        render(<DataRules variant="pipeline" />);
        expect(
            screen.getByText(/steps and the judges that score them/),
        ).toBeInTheDocument();
        // Pipeline steps can call the makers directly too.
        expect(
            screen.getByText(/Steps on Anthropic or the Gemini API directly/),
        ).toBeInTheDocument();
    });
});
