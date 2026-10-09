import { afterEach, describe, expect, it } from "vitest";
import {
    act,
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
} from "@testing-library/react";
import { Button } from "./button";
import { SubmitButton } from "./submit-button";

afterEach(cleanup);

// jsdom has no layout engine, so width is asserted structurally: the label
// stays in the flow (only `invisible`, via a layout-neutral `contents`
// wrapper), the spinner is taken out of flow (`absolute inset-0`), and the
// sizing classes do not change between idle and loading.
const SIZING = /^(h-|px-|py-|w-|min-w-|size-|gap-|text-)/;
function sizingClasses(el: HTMLElement): string[] {
    return [...el.classList].filter((c) => SIZING.test(c)).sort();
}

describe("Button loading", () => {
    it("keeps the label in flow and overlays the spinner, so width is preserved", () => {
        const { rerender } = render(
            <Button size="default">Save changes</Button>,
        );
        const idle = screen.getByRole("button");
        const idleSizing = sizingClasses(idle);
        expect(idle).not.toHaveAttribute("aria-busy");

        rerender(
            <Button size="default" loading>
                Save changes
            </Button>,
        );
        const busy = screen.getByRole("button");
        expect(sizingClasses(busy)).toEqual(idleSizing);
        expect(busy).toHaveClass("relative");

        const label = busy.querySelector('[data-slot="button-label"]');
        expect(label).toHaveTextContent("Save changes");
        expect(label).toHaveClass("invisible", "contents");

        const overlay = busy.querySelector('[data-slot="button-spinner"]');
        expect(overlay).toHaveClass("absolute", "inset-0");
        expect(overlay?.querySelector('[data-slot="spinner"]')).not.toBeNull();
    });

    it("sets aria-busy and disabled, and uses loadingText as the accessible name", () => {
        render(
            <Button loading loadingText="Saving…">
                Save
            </Button>,
        );
        const button = screen.getByRole("button", { name: "Saving…" });
        expect(button).toHaveAttribute("aria-busy", "true");
        expect(button).toBeDisabled();
    });

    it("keeps the children as the accessible name without loadingText", () => {
        render(<Button loading>Delete</Button>);
        expect(screen.getByRole("button", { name: "Delete" })).toHaveAttribute(
            "aria-busy",
            "true",
        );
    });

    it("renders a spinner at the small size for sm buttons", () => {
        render(
            <Button size="sm" loading>
                Run
            </Button>,
        );
        expect(
            screen.getByRole("button").querySelector('[data-slot="spinner"]'),
        ).toHaveClass("size-3.5");
    });

    it("applies only the busy attributes when rendering another element", () => {
        render(
            <Button
                loading
                nativeButton={false}
                render={<span role="presentation" data-testid="custom" />}
            >
                Runs
            </Button>,
        );
        const custom = screen.getByTestId("custom");
        expect(custom).toHaveAttribute("aria-busy", "true");
        expect(custom).toHaveTextContent("Runs");
        expect(custom.querySelector('[data-slot="spinner"]')).toBeNull();
    });
});

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => {
        resolve = r;
    });
    return { promise, resolve };
}

describe("SubmitButton", () => {
    it("shows loading while its form action is pending", async () => {
        const gate = deferred();
        render(
            <form action={() => gate.promise}>
                <SubmitButton loadingText="Saving…">Save</SubmitButton>
            </form>,
        );
        const button = screen.getByRole("button", { name: "Save" });
        expect(button).toHaveAttribute("type", "submit");

        fireEvent.click(button);
        await waitFor(() =>
            expect(screen.getByRole("button")).toHaveAttribute(
                "aria-busy",
                "true",
            ),
        );
        expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();

        await act(async () => {
            gate.resolve();
            await gate.promise;
        });
        await waitFor(() =>
            expect(
                screen.getByRole("button", { name: "Save" }),
            ).not.toHaveAttribute("aria-busy"),
        );
    });

    it("scopes pending to the clicked button when intents differ", async () => {
        const gate = deferred();
        let submittedIntent: FormDataEntryValue | null = null;
        render(
            <form
                action={(formData: FormData) => {
                    submittedIntent = formData.get("intent");
                    return gate.promise;
                }}
            >
                <SubmitButton intent="save">Save</SubmitButton>
                <SubmitButton intent="optimize">Optimize</SubmitButton>
            </form>,
        );

        fireEvent.click(screen.getByRole("button", { name: "Optimize" }));
        await waitFor(() =>
            expect(
                screen.getByRole("button", { name: "Optimize" }),
            ).toHaveAttribute("aria-busy", "true"),
        );
        expect(submittedIntent).toBe("optimize");
        expect(
            screen.getByRole("button", { name: "Save" }),
        ).not.toHaveAttribute("aria-busy");
        // ...but can't start a second submission meanwhile.
        expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

        await act(async () => {
            gate.resolve();
            await gate.promise;
        });
    });

    it("does not allow intent with a function formAction", () => {
        // React reserves `name` on buttons whose formAction is a function, so
        // the intent could never be submitted; the types reject the pairing.
        const element = (
            // @ts-expect-error intent requires a string formAction
            <SubmitButton intent="save" formAction={() => undefined}>
                Save
            </SubmitButton>
        );
        expect(element).toBeDefined();
    });
});

describe("Button link variant", () => {
    it.each(["default", "sm", "lg"] as const)(
        "drops control height and padding at size %s",
        (size) => {
            render(
                <Button variant="link" size={size}>
                    Show more
                </Button>,
            );
            const link = screen.getByRole("button", { name: "Show more" });
            expect(link).toHaveClass("h-auto", "p-0");
            expect(link.className).not.toMatch(/(^| )(h-(8|10|12)|px-\d)/);
        },
    );

    it("keeps the control height for other variants", () => {
        render(<Button variant="secondary">Save</Button>);
        expect(screen.getByRole("button", { name: "Save" })).toHaveClass(
            "h-10",
        );
    });
});
