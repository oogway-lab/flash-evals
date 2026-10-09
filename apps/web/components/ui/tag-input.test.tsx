import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { TagInput } from "./tag-input";

afterEach(cleanup);

function Harness({
    initial = "",
    suggestions = [] as string[],
}: {
    initial?: string;
    suggestions?: string[];
}) {
    const [value, setValue] = useState(initial);
    return (
        <>
            <TagInput
                value={value}
                onChange={setValue}
                suggestions={suggestions}
                placeholder="Add a tag"
            />
            <output data-testid="value">{value}</output>
        </>
    );
}

describe("TagInput", () => {
    it("adds a chip on Enter and writes a comma-joined value", () => {
        const { getByRole, getByTestId, getByLabelText } = render(<Harness />);
        const input = getByRole("textbox");
        fireEvent.change(input, { target: { value: "extraction" } });
        fireEvent.keyDown(input, { key: "Enter" });

        expect(getByLabelText("Remove extraction")).toBeTruthy();
        expect(getByTestId("value").textContent).toBe("extraction");
    });

    it("collapses case-insensitive duplicates", () => {
        const { getByRole, getByTestId } = render(
            <Harness initial="Extraction" />,
        );
        const input = getByRole("textbox");
        fireEvent.change(input, { target: { value: "extraction" } });
        fireEvent.keyDown(input, { key: "Enter" });

        expect(getByTestId("value").textContent).toBe("Extraction");
    });

    it("removes a chip and updates the value", () => {
        const { getByLabelText, getByTestId } = render(
            <Harness initial="alpha, beta" />,
        );
        fireEvent.click(getByLabelText("Remove alpha"));

        expect(getByTestId("value").textContent).toBe("beta");
    });

    it("filters suggestions and adds the chosen one", () => {
        const { getByRole, getByTestId } = render(
            <Harness suggestions={["food-plate", "image-eval"]} />,
        );
        const input = getByRole("textbox");
        fireEvent.change(input, { target: { value: "ima" } });
        fireEvent.click(getByRole("button", { name: "image-eval" }));

        expect(getByTestId("value").textContent).toBe("image-eval");
    });
});
