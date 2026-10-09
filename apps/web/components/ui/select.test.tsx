import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "./select";
import { pickOption } from "./test-utils";

afterEach(cleanup);

const datasets = [
    { id: "d1", name: "Receipts", count: 12 },
    { id: "d2", name: "Invoices", count: 3 },
];

function DatasetSelect() {
    const [value, setValue] = useState("d2");
    return (
        <Select value={value} onValueChange={setValue}>
            <SelectTrigger aria-label="Dataset">
                <SelectValue placeholder="Choose a dataset" />
            </SelectTrigger>
            <SelectContent>
                {datasets.map((dataset) => (
                    <SelectItem key={dataset.id} value={dataset.id}>
                        {dataset.name} ({dataset.count} items
                        {dataset.count > 5 ? ", large" : ""})
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}

describe("Select", () => {
    it("shows the selected item's label, including non-string labels", () => {
        render(<DatasetSelect />);
        expect(
            screen.getByRole("combobox", { name: "Dataset" }),
        ).toHaveTextContent("Invoices (3 items)");
    });

    it("settles with labels that are new nodes on every render, and follows a change", () => {
        render(<DatasetSelect />);
        const trigger = screen.getByRole("combobox", { name: "Dataset" });
        fireEvent.click(trigger);
        pickOption(
            screen.getByRole("option", { name: "Receipts (12 items, large)" }),
        );
        expect(trigger).toHaveTextContent("Receipts (12 items, large)");
    });
});

function Dot({ color }: { color: string }) {
    return <span data-testid="dot" data-color={color} />;
}

function SwatchSelect() {
    const [color, setColor] = useState("red");
    return (
        <>
            <button type="button" onClick={() => setColor("blue")}>
                Recolor
            </button>
            <Select value="a">
                <SelectTrigger aria-label="Swatch">
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="a">
                        <Dot color={color} />
                    </SelectItem>
                </SelectContent>
            </Select>
        </>
    );
}

describe("Select labels with non-text elements", () => {
    it("does not keep a stale label when only an element's props change", () => {
        render(<SwatchSelect />);
        const trigger = screen.getByRole("combobox", { name: "Swatch" });
        expect(trigger.querySelector("[data-testid=dot]")).toHaveAttribute(
            "data-color",
            "red",
        );
        fireEvent.click(screen.getByRole("button", { name: "Recolor" }));
        expect(trigger.querySelector("[data-testid=dot]")).toHaveAttribute(
            "data-color",
            "blue",
        );
    });
});
