import { describe, expect, it } from "vitest";
import type { ICreateRunRequest } from "@flash-evals/api-contract";
import type { IDb } from "../../db.js";
import {
    countItemFilterMatchesPayload,
    filterItemsByLabel,
    resolveItemFilter,
} from "./itemFilter.js";

const benchmark: ICreateRunRequest["benchmark"] = {
    taskMap: {
        tasks: [
            {
                key: "call_type",
                name: "Call type",
                method: "agreement",
                fields: [{ path: "$.call_type", matcher: "exact" }],
            },
            {
                key: "summary",
                name: "Summary",
                method: "head_to_head",
                paths: ["$.summary"],
            },
        ],
    },
};

function labelsDb(labels: Record<string, unknown>): IDb & { sql: string[] } {
    const sql: string[] = [];
    return {
        sql,
        query: async (text: string, params: unknown[]) => {
            sql.push(text);
            const ids = params[0] as string[];
            return {
                rows: ids
                    .filter((id) => id in labels)
                    .map((id) => ({
                        dataset_item_id: id,
                        label_json: labels[id],
                    })),
            };
        },
    } as unknown as IDb & { sql: string[] };
}

describe("resolveItemFilter", () => {
    it("is undefined without a filter", () => {
        expect(resolveItemFilter({ benchmark })).toBeUndefined();
    });

    it("resolves a task's field path", () => {
        expect(
            resolveItemFilter({
                benchmark,
                itemFilter: { taskKey: "call_type", equals: "Sales" },
            }),
        ).toEqual({
            taskKey: "call_type",
            path: "$.call_type",
            equals: "Sales",
        });
        expect(
            resolveItemFilter({
                itemFilter: { path: "$.meta.region", equals: "north" },
            }),
        ).toEqual({ path: "$.meta.region", equals: "north" });
    });

    it.each([
        [{ taskKey: "missing", equals: "x" }, "is not a task"],
        [{ taskKey: "summary", equals: "x" }, "compares one field"],
        [{ equals: "x" }, "needs a taskKey"],
        [{ path: "$.a..b", equals: "x" }, "is not a $.field path"],
        [{ taskKey: "call_type", equals: "" }, "equals must be"],
        [{ taskKey: "call_type", equals: { a: 1 } }, "equals must be"],
        [
            { taskKey: "call_type", path: "$.other", equals: "x" },
            "is not task call_type's field",
        ],
    ])("refuses %j", (itemFilter, message) => {
        expect(() =>
            resolveItemFilter({
                benchmark,
                itemFilter: itemFilter as ICreateRunRequest["itemFilter"],
            }),
        ).toThrow(message);
    });
});

describe("filterItemsByLabel", () => {
    const items = [{ id: "i1" }, { id: "i2" }, { id: "i3" }, { id: "i4" }];

    it("keeps the items whose stored answer has the label, in order, ignoring case", async () => {
        const db = labelsDb({
            i1: { call_type: "Sales" },
            i2: { call_type: "service" },
            i4: { call_type: " sales " },
        });
        expect(
            await filterItemsByLabel(db, items, {
                path: "$.call_type",
                equals: "sales",
            }),
        ).toEqual([{ id: "i1" }, { id: "i4" }]);
    });

    it("matches booleans given as text", async () => {
        const db = labelsDb({ i1: { flag: true }, i2: { flag: false } });
        expect(
            await filterItemsByLabel(db, items, {
                path: "$.flag",
                equals: "true",
            }),
        ).toEqual([{ id: "i1" }]);
    });

    it("refuses a filter no item matches, and skips the query without one", async () => {
        const db = labelsDb({ i1: { call_type: "service" } });
        await expect(
            filterItemsByLabel(db, items, {
                path: "$.call_type",
                equals: "sales",
            }),
        ).rejects.toThrow(
            'No item\'s stored answer has $.call_type equal to "sales".',
        );
        const untouched = labelsDb({});
        expect(await filterItemsByLabel(untouched, items, undefined)).toBe(
            items,
        );
        expect(untouched.sql).toEqual([]);
    });
});

describe("countItemFilterMatchesPayload", () => {
    const request = {
        teamId: "team-1",
        projectId: "project-1",
        datasetId: "ds-1",
        path: "$.call_type",
        equals: "sales",
    };

    function datasetDb(
        found: boolean,
        labels: Record<string, unknown>,
    ): IDb & { params: unknown[][] } {
        const params: unknown[][] = [];
        return {
            params,
            query: async (text: string, values: unknown[]) => {
                params.push(values);
                if (text.includes("from datasets"))
                    return { rows: found ? [{ id: "ds-1" }] : [] };
                if (text.includes("from dataset_items"))
                    return {
                        rows: ["i1", "i2", "i3", "i4"].map((id) => ({ id })),
                    };
                const ids = values[0] as string[];
                return {
                    rows: ids
                        .filter((id) => id in labels)
                        .map((id) => ({
                            dataset_item_id: id,
                            label_json: labels[id],
                        })),
                };
            },
        } as unknown as IDb & { params: unknown[][] };
    }

    it("counts the dataset's items the filter keeps, by the run's rule", async () => {
        const db = datasetDb(true, {
            i1: { call_type: "Sales" },
            i2: { call_type: "service" },
            i4: { call_type: " sales " },
        });
        expect(await countItemFilterMatchesPayload(db, request)).toEqual({
            matching: 2,
            total: 4,
        });
        expect(db.params[0]).toEqual(["ds-1", "team-1", "project-1"]);
    });

    it("returns 0 when nothing matches instead of refusing", async () => {
        const db = datasetDb(true, { i1: { call_type: "service" } });
        expect(await countItemFilterMatchesPayload(db, request)).toEqual({
            matching: 0,
            total: 4,
        });
    });

    it("refuses another project's dataset and a bad path", async () => {
        await expect(
            countItemFilterMatchesPayload(datasetDb(false, {}), request),
        ).rejects.toThrow("Dataset not found");
        await expect(
            countItemFilterMatchesPayload(datasetDb(true, {}), {
                ...request,
                path: "$.a..b",
            }),
        ).rejects.toThrow("is not a $.field path");
    });
});
