import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { WorkflowRunSettings, describeDataRules } from "./run-settings";

afterEach(cleanup);

describe("WorkflowRunSettings", () => {
    it("shows the spend limit and data rules a run started with", () => {
        render(
            <WorkflowRunSettings
                config={{
                    maxCostUsd: 5,
                    dataPolicy: {
                        onlyHosts: ["vertex", "bedrock"],
                        zeroDataRetention: true,
                    },
                }}
            />,
        );
        const settings = screen.getByLabelText("Run settings");
        expect(settings).toHaveTextContent("Spend limit$5.00");
        expect(settings).toHaveTextContent(
            "Data rulesOnly vertex, bedrock · zero data retention",
        );
    });

    it("renders nothing for a run started without either", () => {
        const { container } = render(<WorkflowRunSettings config={{}} />);
        expect(container).toBeEmptyDOMElement();
        render(<WorkflowRunSettings config={undefined} />);
        expect(screen.queryByLabelText("Run settings")).not.toBeInTheDocument();
    });

    it("describes every rule in plain words", () => {
        expect(
            describeDataRules({
                disallowPromptTraining: true,
                zeroDataRetention: true,
            }),
        ).toBe("zero data retention · no training on prompts");
    });
});
