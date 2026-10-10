import { describe, expect, it, vi } from "vitest";
import { bootstrapPilotTeam } from "./bootstrap-pilot-team";

const teamId = "11111111-1111-4111-8111-111111111111";
const teamName = "Oogway Labs";

function fakeClient(
    responses: Array<{ rows: Array<Record<string, unknown>> }>,
) {
    const query = vi.fn(
        async (..._args: unknown[]) => responses.shift() ?? { rows: [] },
    );
    return { query };
}

describe("bootstrapPilotTeam", () => {
    it("creates the configured team only when teams is empty", async () => {
        const client = fakeClient([
            { rows: [] },
            { rows: [{ table_name: "teams" }] },
            { rows: [] },
            { rows: [] },
            { rows: [] },
            { rows: [] },
            { rows: [] },
        ]);

        await expect(
            bootstrapPilotTeam(client as never, teamId, teamName),
        ).resolves.toBe("created");

        expect(client.query).toHaveBeenCalledWith(
            "LOCK TABLE public.teams IN SHARE ROW EXCLUSIVE MODE",
        );
        expect(client.query).toHaveBeenCalledWith(
            "INSERT INTO public.teams (id, name) VALUES ($1, $2)",
            [teamId, teamName],
        );
        expect(client.query).toHaveBeenLastCalledWith("COMMIT");
        expect(
            client.query.mock.calls.some(([statement]) =>
                String(statement).includes("TRUNCATE"),
            ),
        ).toBe(false);
    });

    it("is idempotent when the configured team already exists", async () => {
        const client = fakeClient([
            { rows: [] },
            { rows: [{ table_name: "teams" }] },
            { rows: [] },
            { rows: [{ id: teamId, name: teamName }] },
            { rows: [] },
            { rows: [] },
        ]);

        await expect(
            bootstrapPilotTeam(client as never, teamId, teamName),
        ).resolves.toBe("already-exists");
        expect(client.query).toHaveBeenLastCalledWith("COMMIT");
        expect(client.query).not.toHaveBeenCalledWith(
            "INSERT INTO public.teams (id, name) VALUES ($1, $2)",
            [teamId, teamName],
        );
    });

    it("rolls back when the table contains another team's data", async () => {
        const client = fakeClient([
            { rows: [] },
            { rows: [{ table_name: "teams" }] },
            { rows: [] },
            { rows: [] },
            { rows: [{ id: "22222222-2222-4222-8222-222222222222" }] },
            { rows: [] },
        ]);

        await expect(
            bootstrapPilotTeam(client as never, teamId, teamName),
        ).rejects.toThrow("contains another team");
        expect(client.query).toHaveBeenLastCalledWith("ROLLBACK");
    });

    it("rejects another team even when the configured team also exists", async () => {
        const client = fakeClient([
            { rows: [] },
            { rows: [{ table_name: "teams" }] },
            { rows: [] },
            { rows: [{ id: teamId, name: teamName }] },
            { rows: [{ id: "22222222-2222-4222-8222-222222222222" }] },
            { rows: [] },
        ]);

        await expect(
            bootstrapPilotTeam(client as never, teamId, teamName),
        ).rejects.toThrow("contains another team");
        expect(client.query).toHaveBeenLastCalledWith("ROLLBACK");
        expect(client.query).not.toHaveBeenCalledWith(
            "INSERT INTO public.teams (id, name) VALUES ($1, $2)",
            [teamId, teamName],
        );
    });

    it("does not overwrite a team name or run if migrations are missing", async () => {
        const conflict = fakeClient([
            { rows: [] },
            { rows: [{ table_name: "teams" }] },
            { rows: [] },
            { rows: [{ id: teamId, name: "Existing name" }] },
            { rows: [] },
        ]);
        await expect(
            bootstrapPilotTeam(conflict as never, teamId, teamName),
        ).rejects.toThrow("different name");
        expect(conflict.query).toHaveBeenLastCalledWith("ROLLBACK");

        const noTable = fakeClient([
            { rows: [] },
            { rows: [{ table_name: null }] },
            { rows: [] },
        ]);
        await expect(
            bootstrapPilotTeam(noTable as never, teamId, teamName),
        ).rejects.toThrow("run the reviewed migrations first");
        expect(noTable.query).toHaveBeenLastCalledWith("ROLLBACK");
    });
});
