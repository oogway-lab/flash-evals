import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
    normalizedDataPolicy,
    sameDataPolicy,
    snapshotHasDataPolicy,
    cachedRouteMatches,
} from "./dataPolicyReuse";

describe("normalizedDataPolicy", () => {
    it("sorts and dedupes hosts and fills missing flags", () => {
        expect(
            normalizedDataPolicy({
                onlyHosts: ["vertex", "bedrock", "vertex"],
            }),
        ).toEqual({
            onlyHosts: ["bedrock", "vertex"],
            zeroDataRetention: false,
            disallowPromptTraining: false,
        });
    });

    it("is undefined when no rule is set", () => {
        expect(normalizedDataPolicy(undefined)).toBeUndefined();
        expect(normalizedDataPolicy({})).toBeUndefined();
        expect(
            normalizedDataPolicy({
                onlyHosts: [],
                zeroDataRetention: false,
            }),
        ).toBeUndefined();
    });
});

describe("sameDataPolicy", () => {
    it("compares hosts as a set", () => {
        expect(
            sameDataPolicy(
                { onlyHosts: ["vertex", "bedrock"] },
                { onlyHosts: ["bedrock", "vertex", "bedrock"] },
            ),
        ).toBe(true);
        expect(
            sameDataPolicy(
                { onlyHosts: ["vertex"] },
                { onlyHosts: ["vertex", "openai"] },
            ),
        ).toBe(false);
    });

    it("treats a missing flag as false", () => {
        expect(
            sameDataPolicy(
                { zeroDataRetention: true },
                {
                    onlyHosts: [],
                    zeroDataRetention: true,
                    disallowPromptTraining: false,
                },
            ),
        ).toBe(true);
        expect(
            sameDataPolicy(
                { zeroDataRetention: true },
                { zeroDataRetention: true, disallowPromptTraining: true },
            ),
        ).toBe(false);
    });

    it("never matches rules against no rules", () => {
        expect(sameDataPolicy({ zeroDataRetention: true }, undefined)).toBe(
            false,
        );
        expect(sameDataPolicy(undefined, { onlyHosts: ["vertex"] })).toBe(
            false,
        );
        expect(sameDataPolicy(undefined, {})).toBe(true);
    });
});

describe("snapshotHasDataPolicy", () => {
    it("compares the cached run's rules with these, hosts as a set", () => {
        const policy = normalizedDataPolicy({
            onlyHosts: ["vertex", "bedrock"],
            zeroDataRetention: true,
        })!;
        const query = new PgDialect().sqlToQuery(
            snapshotHasDataPolicy(sql.raw("runs.config_snapshot"), policy),
        );
        const text = query.sql.replace(/\s+/g, " ");

        expect(text).toContain(
            "jsonb_typeof((runs.config_snapshot->'dataPolicy')) = 'object'",
        );
        // Containment both ways: same hosts, any order or repeats.
        expect(text).toContain(
            "coalesce((runs.config_snapshot->'dataPolicy')->'onlyHosts', '[]'::jsonb) @> $1::jsonb",
        );
        expect(text).toContain(
            "$2::jsonb @> coalesce((runs.config_snapshot->'dataPolicy')->'onlyHosts', '[]'::jsonb)",
        );
        expect(text).toContain(
            "coalesce((runs.config_snapshot->'dataPolicy')->'zeroDataRetention' = 'true'::jsonb, false) = $3::boolean",
        );
        expect(text).toContain(
            "coalesce((runs.config_snapshot->'dataPolicy')->'disallowPromptTraining' = 'true'::jsonb, false) = $4::boolean",
        );
        expect(query.params).toEqual([
            '["bedrock","vertex"]',
            '["bedrock","vertex"]',
            true,
            false,
        ]);
    });
});

describe("cachedRouteMatches", () => {
    const render = (route: Parameters<typeof cachedRouteMatches>[2]) =>
        new PgDialect().sqlToQuery(
            cachedRouteMatches(
                sql`cached_model`,
                sql`provider_metadata`,
                route,
            ),
        );

    it("compares the provider's own model id (Bifrost) too", () => {
        const query = render({
            transport: "bifrost",
            transportModelId: "openai/gpt-4o-2024",
        });
        expect(query.sql).toContain(
            "cached_model->>'transportModelId' is not distinct from $2",
        );
        expect(query.params).toEqual(["bifrost", "openai/gpt-4o-2024"]);
        expect(query.sql).not.toContain("provider_metadata");
    });

    it("for auto, requires the answer to have gone over the same provider", () => {
        const query = render({
            transport: undefined,
            resolvedTransport: "gateway",
        });
        expect(query.sql).toContain("provider_metadata->>'transport' = $3");
        expect(query.params).toEqual([null, null, "gateway"]);
    });
});
