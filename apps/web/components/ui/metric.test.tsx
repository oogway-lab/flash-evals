import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Metric, MetricList } from "./metric";

afterEach(cleanup);

describe("Metric", () => {
    it("renders a term and a tabular value inside a description list", () => {
        const { container } = render(
            <MetricList>
                <Metric label="WER" value="12.0%" />
                <Metric plain label="Tokens" value="1,024" />
                <Metric mono label="Model" value="gpt-5" />
            </MetricList>,
        );
        expect(container.querySelector("dl")).toBeInTheDocument();
        expect(screen.getByText("WER").tagName).toBe("DT");
        expect(screen.getByText("12.0%")).toHaveClass("tabular-nums");
        expect(screen.getByText("12.0%")).not.toHaveClass("text-mono-13");
        expect(screen.getByText("gpt-5")).toHaveClass("text-mono-13");
        const [inset, plain] = container.querySelectorAll(
            '[data-slot="metric"]',
        );
        expect(inset).toHaveClass("bg-surface");
        expect(inset).not.toHaveClass("border");
        expect(plain).not.toHaveClass("bg-surface");
    });
});
