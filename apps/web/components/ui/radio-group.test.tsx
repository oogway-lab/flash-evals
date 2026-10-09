import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
} from "@testing-library/react";
import { RadioCard, RadioGroup } from "./radio-group";

afterEach(cleanup);

function Harness() {
    const [value, setValue] = useState("a");
    return (
        <>
            <RadioGroup
                aria-label="Choice"
                value={value}
                onValueChange={setValue}
            >
                <RadioCard value="a" title="Alpha" description="First" />
                <RadioCard value="b" title="Beta" description="Second" />
                <RadioCard value="c" title="Gamma" />
            </RadioGroup>
            <output>{value}</output>
        </>
    );
}

describe("RadioGroup", () => {
    it("exposes radio semantics inside a named group", () => {
        render(<Harness />);
        expect(
            screen.getByRole("radiogroup", { name: "Choice" }),
        ).toBeInTheDocument();
        expect(screen.getByRole("radio", { name: /Alpha/ })).toHaveAttribute(
            "aria-checked",
            "true",
        );
        expect(screen.getAllByRole("radio")).toHaveLength(3);
    });

    it("selects on click", () => {
        render(<Harness />);
        fireEvent.click(screen.getByRole("radio", { name: /Beta/ }));
        expect(screen.getByRole("status")).toHaveTextContent("b");
    });

    it("moves and selects with the arrow keys", async () => {
        render(<Harness />);
        const alpha = screen.getByRole("radio", { name: /Alpha/ });
        alpha.focus();
        fireEvent.keyDown(alpha, { key: "ArrowDown" });
        const beta = screen.getByRole("radio", { name: /Beta/ });
        await waitFor(() => expect(beta).toHaveFocus());
        await waitFor(() =>
            expect(screen.getByRole("status")).toHaveTextContent("b"),
        );
    });

    it("uses a surface change on hover, not a border colour", () => {
        render(<Harness />);
        const card = screen.getByRole("radio", { name: /Alpha/ });
        expect(card.className).toContain("hover:bg-muted/60");
        expect(card.className).not.toMatch(/hover:border/);
    });
});
