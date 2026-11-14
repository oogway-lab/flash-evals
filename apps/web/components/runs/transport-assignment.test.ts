import { describe, expect, it } from "vitest";
import type { IRunSetupModelOption } from "@flash-evals/api-contract";
import { transportAssignmentFor } from "./provider-select";

const model = {
    id: "google/gemini-2.5-flash",
    transports: ["bifrost", "gateway"],
    providers: [
        {
            transport: "bifrost",
            modelId: "openrouter/google/gemini-2.5-flash",
            keySaved: true,
        },
        {
            transport: "gateway",
            modelId: "google/gemini-2.5-flash",
            keySaved: true,
        },
    ],
} as unknown as IRunSetupModelOption;

describe("transportAssignmentFor", () => {
    it("sends the id Bifrost lists the model under", () => {
        expect(transportAssignmentFor(model, model.id, "bifrost")).toEqual([
            {
                modelId: "google/gemini-2.5-flash",
                transport: "bifrost",
                transportModelId: "openrouter/google/gemini-2.5-flash",
            },
        ]);
    });

    it("leaves other providers and no provider as before", () => {
        expect(transportAssignmentFor(model, model.id, "gateway")).toEqual([
            { modelId: "google/gemini-2.5-flash", transport: "gateway" },
        ]);
        expect(transportAssignmentFor(model, model.id, undefined)).toEqual([]);
    });
});
