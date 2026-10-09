import { afterEach, describe, expect, it, vi } from "vitest";
import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
} from "@testing-library/react";
import { CellDrawer } from "./cell-drawer";
import type { DrawerPayload } from "./types";

afterEach(cleanup);

const PAYLOAD: DrawerPayload = {
    cell: {
        id: "cell-1",
        datasetItemId: "item-1",
        runModelId: "rm-1",
        status: "succeeded",
        outputJson: null,
        latencyMs: 1200,
        costUsd: 0.01,
        promptTokens: 10,
        completionTokens: 20,
        error: null,
    },
    model: { id: "rm-1", modelId: "openai/gpt-4o", isReference: false },
    item: {
        id: "item-1",
        type: "text",
        inputText: "Hello",
        storageKey: null,
        mimeType: null,
    },
    scores: [],
};

const noop = async () => ({ ok: true });

describe("CellDrawer", () => {
    it("keeps the last payload when data is cleared so the exit animation can run", () => {
        const { rerender } = render(
            <CellDrawer
                open
                onClose={noop}
                data={PAYLOAD}
                modelDisplayName="GPT-4o"
                saveCellAnnotationAction={noop}
            />,
        );
        expect(
            screen.getByRole("heading", { name: "GPT-4o" }),
        ).toBeInTheDocument();

        rerender(
            <CellDrawer
                open
                onClose={noop}
                data={null}
                saveCellAnnotationAction={noop}
            />,
        );
        expect(
            screen.getByRole("heading", { name: "GPT-4o" }),
        ).toBeInTheDocument();
    });

    it("renders nothing before any payload has been set", () => {
        render(
            <CellDrawer
                open={false}
                onClose={noop}
                data={null}
                saveCellAnnotationAction={noop}
            />,
        );
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("stays on the cell and shows the error when Save and next fails", async () => {
        const onNext = vi.fn();
        const save = vi.fn(async () => ({ formError: "Cell not found" }));
        render(
            <CellDrawer
                open
                onClose={() => undefined}
                onNext={onNext}
                data={PAYLOAD}
                modelDisplayName="GPT-4o"
                saveCellAnnotationAction={save}
            />,
        );

        fireEvent.click(screen.getByRole("button", { name: "Save and next" }));

        expect(await screen.findByRole("alert")).toHaveTextContent(
            "Cell not found",
        );
        expect(save).toHaveBeenCalledTimes(1);
        expect(onNext).not.toHaveBeenCalled();
    });

    it("moves to the next cell after a successful Save and next", async () => {
        const onNext = vi.fn();
        render(
            <CellDrawer
                open
                onClose={() => undefined}
                onNext={onNext}
                data={PAYLOAD}
                modelDisplayName="GPT-4o"
                saveCellAnnotationAction={async () => ({ ok: true })}
            />,
        );

        fireEvent.click(screen.getByRole("button", { name: "Save and next" }));

        await waitFor(() => expect(onNext).toHaveBeenCalledTimes(1));
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
});
