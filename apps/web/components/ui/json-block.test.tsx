import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { JsonBlock } from "./json-block";

afterEach(cleanup);

describe("JsonBlock", () => {
    it("gives the icon-only copy button an accessible name", () => {
        render(<JsonBlock data={{ a: 1 }} />);
        expect(
            screen.getByRole("button", { name: "Copy JSON" }),
        ).toBeInTheDocument();
    });
});
