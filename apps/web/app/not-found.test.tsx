import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import NotFound from "./not-found";

describe("NotFound", () => {
    afterEach(cleanup);

    it("sends people back to the dashboard, which always exists", () => {
        render(<NotFound />);
        expect(
            screen.getByRole("link", { name: "Go to dashboard" }),
        ).toHaveAttribute("href", "/");
    });
});
