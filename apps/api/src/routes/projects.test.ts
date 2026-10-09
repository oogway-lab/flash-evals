import { describe, expect, it, vi } from "vitest";
import type { IDb } from "../db.js";
import {
    createProjectPayload,
    listProjectsPayload,
    updateProjectPayload,
} from "./projects.js";

const TEAM_ID = "11111111-1111-4111-8111-111111111111";

describe("project payloads", () => {
    it("renames a project for an authorized team member while preserving its id", async () => {
        const query = vi.fn(async () => ({
            rows: [
                {
                    id: "project-1",
                    team_id: TEAM_ID,
                    workspace_id: "workspace-1",
                    name: "Renamed",
                    created_by: "user-1",
                    created_at: new Date("2026-07-11T00:00:00.000Z"),
                },
            ],
        }));
        const db = { query } as unknown as IDb;

        await expect(
            updateProjectPayload(db, {
                teamId: TEAM_ID,
                workspaceId: "workspace-1",
                projectId: "project-1",
                name: "  Renamed  ",
                updatedBy: "user-1",
            }),
        ).resolves.toMatchObject({ id: "project-1", name: "Renamed" });
        expect(query).toHaveBeenCalledWith(
            expect.stringContaining("from users u"),
            ["Renamed", "project-1", "workspace-1", TEAM_ID, "user-1"],
        );
    });

    it("rejects blank names before persistence", async () => {
        const query = vi.fn();
        const db = { query } as unknown as IDb;
        await expect(
            updateProjectPayload(db, {
                teamId: TEAM_ID,
                workspaceId: "workspace-1",
                projectId: "project-1",
                name: "   ",
                updatedBy: "user-1",
            }),
        ).rejects.toThrow("Project name is required");
        expect(query).not.toHaveBeenCalled();
    });

    it("rejects a user outside the project team", async () => {
        const query = vi.fn(async () => ({ rows: [] }));
        const db = { query } as unknown as IDb;
        await expect(
            updateProjectPayload(db, {
                teamId: TEAM_ID,
                workspaceId: "workspace-1",
                projectId: "project-1",
                name: "No access",
                updatedBy: "user-from-another-team",
            }),
        ).rejects.toThrow("Project was not found in this team");
    });

    it("creates a project under the requesting team", async () => {
        const query = vi.fn(async () => ({
            rows: [
                {
                    id: "project-1",
                    team_id: TEAM_ID,
                    workspace_id: "workspace-1",
                    name: "Launch",
                    created_by: "user-1",
                    created_at: new Date("2026-07-11T00:00:00.000Z"),
                },
            ],
        }));
        const db = { query } as unknown as IDb;

        await expect(
            createProjectPayload(db, {
                teamId: TEAM_ID,
                workspaceId: "workspace-1",
                name: "  Launch  ",
                createdBy: "user-1",
            }),
        ).resolves.toEqual({
            id: "project-1",
            teamId: TEAM_ID,
            workspaceId: "workspace-1",
            name: "Launch",
            createdBy: "user-1",
            createdAt: "2026-07-11T00:00:00.000Z",
        });
        expect(query).toHaveBeenCalledWith(
            expect.stringContaining("insert into projects"),
            [TEAM_ID, "workspace-1", "Launch", "user-1"],
        );
    });

    it("lists only projects belonging to the requested team", async () => {
        const query = vi.fn(async () => ({
            rows: [
                {
                    id: "project-1",
                    team_id: TEAM_ID,
                    workspace_id: "workspace-1",
                    name: "Default",
                    created_by: "user-1",
                    created_at: new Date("2026-07-11T00:00:00.000Z"),
                },
            ],
        }));
        const db = { query } as unknown as IDb;

        const result = await listProjectsPayload(db, TEAM_ID);

        expect(result).toHaveLength(1);
        expect(query).toHaveBeenCalledWith(
            expect.stringContaining("where team_id = $1"),
            [TEAM_ID, null],
        );
    });

    it("rejects a creator who does not belong to the project team", async () => {
        const query = vi.fn(async () => ({ rows: [] }));
        const db = { query } as unknown as IDb;

        await expect(
            createProjectPayload(db, {
                teamId: TEAM_ID,
                workspaceId: "workspace-1",
                name: "Cross-team project",
                createdBy: "user-from-another-team",
            }),
        ).rejects.toThrow("Project creator was not found in this team");
    });

    it("returns no projects when the requested team owns none", async () => {
        const query = vi.fn(async () => ({ rows: [] }));
        const db = { query } as unknown as IDb;

        await expect(
            listProjectsPayload(db, "22222222-2222-4222-8222-222222222222"),
        ).resolves.toEqual([]);
        expect(query).toHaveBeenCalledWith(
            expect.stringContaining("where team_id = $1"),
            ["22222222-2222-4222-8222-222222222222", null],
        );
    });
});
