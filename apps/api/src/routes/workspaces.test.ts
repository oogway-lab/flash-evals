import { describe, expect, it, vi } from "vitest";
import type { IDb } from "../db.js";
import {
    createWorkspacePayload,
    listWorkspacesPayload,
    updateWorkspacePayload,
} from "./workspaces.js";

const TEAM_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";

describe("workspace payloads", () => {
    it("lets any tenant member create a shared workspace", async () => {
        const query = vi.fn(async () => ({
            rows: [
                {
                    id: WORKSPACE_ID,
                    team_id: TEAM_ID,
                    name: "Research",
                    owner_user_id: "user-2",
                    created_at: new Date("2026-07-28T00:00:00.000Z"),
                },
            ],
        }));

        await expect(
            createWorkspacePayload({ query } as unknown as IDb, {
                teamId: TEAM_ID,
                name: "  Research  ",
                createdBy: "user-2",
            }),
        ).resolves.toMatchObject({
            id: WORKSPACE_ID,
            teamId: TEAM_ID,
            name: "Research",
            ownerUserId: "user-2",
        });
        expect(query).toHaveBeenCalledWith(
            expect.stringContaining("where u.id = $3 and u.team_id = $1"),
            [TEAM_ID, "Research", "user-2"],
        );
    });

    it("lets any tenant member rename a workspace without requiring ownership", async () => {
        const query = vi.fn(async () => ({
            rows: [
                {
                    id: WORKSPACE_ID,
                    team_id: TEAM_ID,
                    name: "Shared research",
                    owner_user_id: "user-1",
                    created_at: new Date("2026-07-28T00:00:00.000Z"),
                },
            ],
        }));

        await expect(
            updateWorkspacePayload({ query } as unknown as IDb, {
                teamId: TEAM_ID,
                workspaceId: WORKSPACE_ID,
                name: "Shared research",
                updatedBy: "user-2",
            }),
        ).resolves.toMatchObject({ name: "Shared research" });
        expect(query).toHaveBeenCalledWith(
            expect.stringContaining("u.id = $4 and u.team_id = w.team_id"),
            ["Shared research", WORKSPACE_ID, TEAM_ID, "user-2"],
        );
    });

    it("filters the workspace list by tenant", async () => {
        const query = vi.fn(async () => ({ rows: [] }));
        await expect(
            listWorkspacesPayload({ query } as unknown as IDb, TEAM_ID),
        ).resolves.toEqual([]);
        expect(query).toHaveBeenCalledWith(
            expect.stringContaining("where team_id = $1"),
            [TEAM_ID],
        );
    });
});
