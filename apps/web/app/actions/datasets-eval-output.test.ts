import { beforeEach, describe, expect, it, vi } from "vitest";
import { MosaicApiError } from "@mosaic/api-contract";

const mockApiClient = vi.hoisted(() => ({
    listWorkspaces: vi.fn(),
    listProjects: vi.fn(),
    createDatasetItem: vi.fn(),
    createDatasetItemFromForm: vi.fn(),
    updateDatasetItem: vi.fn(),
    updateDatasetItemFromForm: vi.fn(),
}));

// Mock all side-effecting dependencies of the dataset actions so we can exercise
// the eval-output branching of editItemAction / addItemAction in isolation.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({
    cookies: vi.fn(async () => ({ get: vi.fn(() => undefined) })),
}));
vi.mock("next/navigation", () => ({
    redirect: vi.fn(),
    unstable_rethrow: vi.fn(),
}));
vi.mock("@/server/auth/session", () => ({
    requirePrincipal: vi.fn(async () => ({
        teamId: "team-1",
        userId: "user-1",
    })),
    assertSameTeam: vi.fn(),
}));
vi.mock("@/server/api/client", () => ({
    serverApiClient: () => mockApiClient,
}));

const getItem = vi.fn();
const getDataset = vi.fn();

vi.mock("@/server/datasets/service", () => ({
    getItem: (...args: unknown[]) => getItem(...args),
    getDataset: (...args: unknown[]) => getDataset(...args),
    DuplicateItemSourceNameError: class extends Error {},
    DUPLICATE_ITEM_SOURCE_NAME_MESSAGE: "dup",
    DeleteItemBlockedError: class extends Error {},
}));

vi.mock("@/server/datasets/answerSchema", () => ({
    resolveAnswerSchema: vi.fn(),
}));
vi.mock("@/server/datasets/import", () => ({
    ALLOWED_IMAGE_TYPES: [],
    MAX_IMAGE_BYTES: 0,
    MAX_TEXT_IMPORT_BYTES: 0,
    goldenItemRefsFromItems: vi.fn(),
    importFreeformImageAnswerItems: vi.fn(),
    importGoldenAnswersForItems: vi.fn(),
    importImageItems: vi.fn(),
    importPairedItems: vi.fn(),
    importTextItems: vi.fn(),
}));

import { editItemAction, addItemAction } from "./datasets";

const evalDataset = {
    id: "ds-eval",
    teamId: "team-1",
    projectId: "project-1",
    purpose: "evaluation" as const,
    pipelineId: null,
    archivedAt: null,
};
const goldenDataset = {
    id: "ds-golden",
    teamId: "team-1",
    projectId: "project-1",
    purpose: "golden" as const,
    pipelineId: null,
    archivedAt: null,
};

function fd(entries: Record<string, string>): FormData {
    const f = new FormData();
    for (const [k, v] of Object.entries(entries)) f.set(k, v);
    return f;
}

beforeEach(() => {
    vi.clearAllMocks();
    mockApiClient.listProjects.mockResolvedValue([
        { id: "project-1", workspaceId: "workspace-1", name: "Default" },
    ]);
    mockApiClient.listWorkspaces.mockResolvedValue([
        { id: "workspace-1", name: "User workspace" },
    ]);
    mockApiClient.createDatasetItem.mockResolvedValue({ datasetId: "ds-eval" });
    mockApiClient.createDatasetItemFromForm.mockResolvedValue({
        datasetId: "ds-eval",
    });
    mockApiClient.updateDatasetItem.mockResolvedValue({ datasetId: "ds-eval" });
    mockApiClient.updateDatasetItemFromForm.mockResolvedValue({
        datasetId: "ds-eval",
    });
});

describe("editItemAction expected-output handling", () => {
    it("saves an expected output on an evaluation item without changing purpose", async () => {
        getItem.mockResolvedValue({ id: "item-1", datasetId: "ds-eval" });
        getDataset.mockResolvedValue(evalDataset);
        const result = await editItemAction(
            {},
            fd({
                itemId: "item-1",
                label: JSON.stringify({ expected: "salad" }),
            }),
        );

        expect(result.ok).toBe(true);
        expect(mockApiClient.updateDatasetItemFromForm).toHaveBeenCalledWith({
            teamId: "team-1",
            projectId: "project-1",
            itemId: "item-1",
            inputText: "",
            rawLabel: JSON.stringify({ expected: "salad" }),
        });
        // The action must never mutate the dataset's purpose.
        expect(evalDataset.purpose).toBe("evaluation");
    });

    it("clears the expected output when an evaluation item is saved empty", async () => {
        getItem.mockResolvedValue({ id: "item-1", datasetId: "ds-eval" });
        getDataset.mockResolvedValue(evalDataset);

        const result = await editItemAction(
            {},
            fd({ itemId: "item-1", label: "{}" }),
        );

        expect(result.ok).toBe(true);
        expect(mockApiClient.updateDatasetItemFromForm).toHaveBeenCalledWith({
            teamId: "team-1",
            projectId: "project-1",
            itemId: "item-1",
            inputText: "",
            rawLabel: "{}",
        });
    });

    it("surfaces a validation error for an invalid expected-output payload", async () => {
        getItem.mockResolvedValue({ id: "item-1", datasetId: "ds-eval" });
        getDataset.mockResolvedValue(evalDataset);
        mockApiClient.updateDatasetItemFromForm.mockRejectedValue(
            new MosaicApiError("Invalid JSON in golden answer.", 400),
        );

        const result = await editItemAction(
            {},
            fd({ itemId: "item-1", label: "{not json" }),
        );

        expect(result.ok).toBeUndefined();
        expect(result.formError).toContain("Invalid JSON");
        expect(mockApiClient.updateDatasetItemFromForm).toHaveBeenCalled();
    });

    it("still requires a parsed label for golden datasets (regression guard)", async () => {
        getItem.mockResolvedValue({ id: "item-2", datasetId: "ds-golden" });
        getDataset.mockResolvedValue(goldenDataset);
        const result = await editItemAction(
            {},
            fd({ itemId: "item-2", label: JSON.stringify({ answer: "yes" }) }),
        );

        expect(result.ok).toBe(true);
        expect(mockApiClient.updateDatasetItemFromForm).toHaveBeenCalledWith({
            teamId: "team-1",
            projectId: "project-1",
            itemId: "item-2",
            inputText: "",
            rawLabel: JSON.stringify({ answer: "yes" }),
        });
    });
});

describe("addItemAction on evaluation datasets", () => {
    it("adds a plain input item without requiring an output", async () => {
        getDataset.mockResolvedValue(evalDataset);

        const result = await addItemAction(
            {},
            fd({ datasetId: "ds-eval", inputText: "an input" }),
        );

        expect(result.ok).toBe(true);
        expect(mockApiClient.createDatasetItemFromForm).toHaveBeenCalledWith({
            teamId: "team-1",
            projectId: "project-1",
            datasetId: "ds-eval",
            inputText: "an input",
            rawLabel: "",
        });
    });
});
