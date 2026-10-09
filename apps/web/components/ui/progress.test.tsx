import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Progress } from "./progress";

afterEach(cleanup);

describe("Progress", () => {
    it("exposes the current value to assistive tech", () => {
        render(<Progress value={40} />);
        const bar = screen.getByRole("progressbar");
        expect(bar).toHaveAttribute("aria-valuenow", "40");
        expect(bar).toHaveAttribute("aria-valuemax", "100");
        expect(bar).toHaveAttribute("data-progressing");
    });

    it("respects a custom max", () => {
        render(<Progress value={3} max={12} />);
        const bar = screen.getByRole("progressbar");
        expect(bar).toHaveAttribute("aria-valuenow", "3");
        expect(bar).toHaveAttribute("aria-valuemax", "12");
    });

    it("clamps out-of-range values", () => {
        render(<Progress value={150} />);
        expect(screen.getByRole("progressbar")).toHaveAttribute(
            "aria-valuenow",
            "100",
        );
    });

    it("omits aria-valuenow when indeterminate", () => {
        render(<Progress value={0} indeterminate />);
        const bar = screen.getByRole("progressbar");
        expect(bar).not.toHaveAttribute("aria-valuenow");
        expect(bar).toHaveAttribute("data-indeterminate");
    });
});
