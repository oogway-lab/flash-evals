import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { IModelPriceRow } from "@flash-evals/api-contract";
import { ModelPriceTable, rowMatches } from "./model-price-table";

afterEach(cleanup);

const glm: IModelPriceRow = {
    id: "zai/glm-5.2",
    label: "GLM 5.2",
    vendor: "Z.ai",
    providers: [
        {
            transport: "gateway",
            modelId: "zai/glm-5.2",
            inputPerMillion: 0.8,
            outputPerMillion: 2.55,
            keySaved: true,
        },
        {
            transport: "openrouter",
            modelId: "z-ai/glm-5.2",
            inputPerMillion: 0.006,
            outputPerMillion: 6.8,
            keySaved: false,
        },
    ],
};
const gemma: IModelPriceRow = {
    id: "google/gemma-4-31b-it",
    label: "Gemma 4 31B",
    vendor: "Gemma",
    providers: [
        {
            transport: "gateway",
            modelId: "google/gemma-4-31b-it",
            inputPerMillion: 0.14,
            outputPerMillion: 0.4,
            keySaved: true,
        },
        {
            transport: "openrouter",
            modelId: "google/gemma-4-31b-it",
            inputPerMillion: 0.2,
            outputPerMillion: 0.4,
            keySaved: false,
        },
    ],
};
const orOnly: IModelPriceRow = {
    id: "nex-agi/nex-1",
    label: "Nex 1",
    vendor: "nex-agi",
    providers: [
        {
            transport: "openrouter",
            modelId: "nex-agi/nex-1",
            keySaved: false,
        },
    ],
};

describe("rowMatches", () => {
    it("filters by which lists carry the model", () => {
        expect(rowMatches(glm, "both", "")).toBe(true);
        expect(rowMatches(orOnly, "both", "")).toBe(false);
        expect(rowMatches(orOnly, "openrouter", "")).toBe(true);
        expect(rowMatches(glm, "gateway", "")).toBe(false);
    });

    it("searches names, vendors and each provider's model ID", () => {
        expect(rowMatches(glm, "all", "z-ai/")).toBe(true);
        expect(rowMatches(glm, "all", "z.ai")).toBe(true);
        expect(rowMatches(glm, "all", "claude")).toBe(false);
    });
});

describe("ModelPriceTable", () => {
    it("shows both prices, each provider's ID, and which one is cheaper", () => {
        render(
            <ModelPriceTable
                models={[glm, gemma, orOnly]}
                savedKeyProviders={["gateway"]}
            />,
        );
        expect(screen.getByText("$0.80 / $2.55")).toBeInTheDocument();
        expect(screen.getByText("$0.006 / $6.80")).toBeInTheDocument();
        expect(screen.getByText("z-ai/glm-5.2")).toBeInTheDocument();
        expect(screen.getAllByText("Cheaper")).toHaveLength(1);
        expect(screen.getByText("Not listed")).toBeInTheDocument();
        expect(screen.getByText(/· no key/)).toBeInTheDocument();
    });

    it("starts a run with the ticked models", () => {
        render(
            <ModelPriceTable
                models={[glm, gemma]}
                savedKeyProviders={["gateway"]}
            />,
        );
        fireEvent.click(screen.getByLabelText("Tick GLM 5.2"));
        fireEvent.click(screen.getByLabelText("Tick Gemma 4 31B"));
        expect(
            screen.getByRole("link", { name: "Start a run with 2 ticked" }),
        ).toHaveAttribute(
            "href",
            `/runs/new?models=${encodeURIComponent("zai/glm-5.2,google/gemma-4-31b-it")}`,
        );
    });
});
