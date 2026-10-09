import { Buffer } from "node:buffer";
import { describe, expect, it, vi } from "vitest";
import type { IDb } from "../db.js";
import {
    clearProviderKeyPayload,
    listProviderKeysPayload,
    setProviderKeyPayload,
} from "./keys.js";

const TEAM_ID = "11111111-1111-4111-8111-111111111111";
const ENC_KEY = Buffer.alloc(32, 5).toString("base64");
const PUBLIC_RESOLVER = vi.fn(async () => ["203.1.1.1"]);

interface IStoredKey {
    id: string;
    teamId: string;
    provider: string;
    ciphertext: string;
    iv: string;
    authTag: string;
    baseUrl: string | null;
    hint: string;
}

function providerKeyDb() {
    const rows = new Map<string, IStoredKey>();
    const query = vi.fn(async (sql: string, values: unknown[] = []) => {
        if (sql.includes("insert into provider_keys")) {
            const [teamId, provider, ciphertext, iv, authTag, baseUrl, hint] =
                values as [
                    string,
                    string,
                    string,
                    string,
                    string,
                    string | null,
                    string,
                ];
            rows.set(`${teamId}:${provider}`, {
                id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                teamId,
                provider,
                ciphertext,
                iv,
                authTag,
                baseUrl,
                hint,
            });
            return { rows: [] };
        }
        if (sql.includes("select id, provider, hint, base_url")) {
            const teamId = values[0];
            return {
                rows: [...rows.values()]
                    .filter((row) => row.teamId === teamId)
                    .map((row) => ({
                        id: row.id,
                        provider: row.provider,
                        hint: row.hint,
                        base_url: row.baseUrl,
                    })),
            };
        }
        if (sql.includes("delete from provider_keys")) {
            rows.delete(`${values[0]}:${values[1]}`);
            return { rows: [] };
        }
        if (sql.includes("delete from stt_route_probes")) {
            return { rows: [] };
        }
        throw new Error(`Unexpected query: ${sql}`);
    });
    return { db: { query } as unknown as IDb, query, rows };
}

describe("provider key payloads", () => {
    it("encrypts stored keys and lists only safe metadata", async () => {
        const { db, rows } = providerKeyDb();
        await setProviderKeyPayload(
            db,
            ENC_KEY,
            {
                teamId: TEAM_ID,
                provider: "openrouter",
                key: "or-secret-1234",
                baseUrl: "https://openrouter.example/v1",
            },
            PUBLIC_RESOLVER,
        );

        const stored = rows.get(`${TEAM_ID}:openrouter`)!;
        expect(stored.ciphertext).not.toContain("or-secret-1234");
        expect(stored.iv).not.toBe("");
        expect(stored.authTag).not.toBe("");

        const listed = await listProviderKeysPayload(db, TEAM_ID);
        expect(listed).toEqual([
            {
                id: expect.any(String),
                provider: "openrouter",
                hint: "••••1234",
                baseUrl: "https://openrouter.example/v1",
            },
        ]);
        expect(JSON.stringify(listed)).not.toContain("or-secret-1234");
        expect(JSON.stringify(listed)).not.toContain(stored.ciphertext);
    });

    it("upserts a second key into the same provider row", async () => {
        const { db, rows, query } = providerKeyDb();
        await setProviderKeyPayload(db, ENC_KEY, {
            teamId: TEAM_ID,
            provider: "openai",
            key: "first-key",
        });
        await setProviderKeyPayload(db, ENC_KEY, {
            teamId: TEAM_ID,
            provider: "openai",
            key: "second-key",
        });

        expect(rows.size).toBe(1);
        expect(rows.get(`${TEAM_ID}:openai`)?.hint).toBe("••••-key");
        expect(
            query.mock.calls
                .map(([sql]) => String(sql))
                .find((sql) => sql.includes("insert into provider_keys")),
        ).toContain("rotation_version = gen_random_uuid()");
        expect(query).toHaveBeenCalledWith(
            expect.stringContaining("delete from stt_route_probes"),
            [
                TEAM_ID,
                [
                    "gpt-4o-transcribe",
                    "gpt-4o-mini-transcribe",
                    "whisper-1",
                    "openai:gpt-4o-transcribe-diarize",
                ],
            ],
        );
    });

    it("clears only the selected team provider key", async () => {
        const { db, rows } = providerKeyDb();
        await setProviderKeyPayload(db, ENC_KEY, {
            teamId: TEAM_ID,
            provider: "soniox",
            key: "soniox-secret",
        });

        await clearProviderKeyPayload(db, {
            teamId: TEAM_ID,
            provider: "soniox",
        });

        expect(rows.size).toBe(0);
    });

    it("rejects invalid team ids and providers before querying", async () => {
        const { db, query } = providerKeyDb();
        await expect(
            setProviderKeyPayload(db, ENC_KEY, {
                teamId: "not-a-uuid",
                provider: "openai",
                key: "secret",
            }),
        ).rejects.toThrow(/teamId/i);
        await expect(
            setProviderKeyPayload(db, ENC_KEY, {
                teamId: TEAM_ID,
                provider: "unknown" as "openai",
                key: "secret",
            }),
        ).rejects.toThrow(/provider/i);
        expect(query).not.toHaveBeenCalled();
    });

    it.each([
        "not a url",
        "http://router.example/v1",
        "https://localhost/v1",
        "https://api.local/v1",
        "https://127.0.0.1/v1",
        "https://10.0.0.1/v1",
        "https://172.16.0.1/v1",
        "https://192.168.1.1/v1",
        "https://169.254.1.1/v1",
        "https://[::1]/v1",
        "https://[fe80::1]/v1",
        "https://[fd00::1]/v1",
        "https://[::ffff:127.0.0.1]/v1",
        "https://[::ffff:10.0.0.1]/v1",
        "https://[::ffff:169.254.1.1]/v1",
        "https://[::ffff:172.16.0.1]/v1",
        "https://[::ffff:192.168.1.1]/v1",
        "https://test-user:example-password@router.example/v1",
        "https://router.example/v1#secret",
    ])("rejects unsafe provider base URL %s", async (baseUrl) => {
        const { db, query } = providerKeyDb();
        await expect(
            setProviderKeyPayload(db, ENC_KEY, {
                teamId: TEAM_ID,
                provider: "openrouter",
                key: "secret",
                baseUrl,
            }),
        ).rejects.toThrow(/baseUrl/i);
        expect(query).not.toHaveBeenCalled();
    });

    it("accepts a custom public HTTPS provider base URL", async () => {
        const { db, rows } = providerKeyDb();
        await setProviderKeyPayload(
            db,
            ENC_KEY,
            {
                teamId: TEAM_ID,
                provider: "bifrost",
                key: "secret",
                baseUrl: "https://bifrost.example/v1",
            },
            PUBLIC_RESOLVER,
        );
        expect(rows.get(`${TEAM_ID}:bifrost`)?.baseUrl).toBe(
            "https://bifrost.example/v1",
        );
    });

    it("requires a Bifrost base URL before storing its credential", async () => {
        const { db, query } = providerKeyDb();
        await expect(
            setProviderKeyPayload(
                db,
                ENC_KEY,
                { teamId: TEAM_ID, provider: "bifrost", key: "secret" },
                PUBLIC_RESOLVER,
            ),
        ).rejects.toThrow(/baseUrl is required for Bifrost/i);
        expect(query).not.toHaveBeenCalled();
    });

    it.each([
        ["private IPv4", ["10.0.0.8"]],
        ["link-local IPv4", ["169.254.169.254"]],
        ["loopback IPv6", ["::1"]],
        ["ULA IPv6", ["fd00::8"]],
        ["mixed public and private answers", ["203.1.1.1", "192.168.1.8"]],
    ])("rejects a hostname resolving to %s", async (_label, addresses) => {
        const { db, query } = providerKeyDb();
        await expect(
            setProviderKeyPayload(
                db,
                ENC_KEY,
                {
                    teamId: TEAM_ID,
                    provider: "bifrost",
                    key: "secret",
                    baseUrl: "https://router.example/v1",
                },
                async () => addresses,
            ),
        ).rejects.toThrow(/resolve only to public/i);
        expect(query).not.toHaveBeenCalled();
    });

    it("rejects an unresolvable hostname", async () => {
        const { db, query } = providerKeyDb();
        await expect(
            setProviderKeyPayload(
                db,
                ENC_KEY,
                {
                    teamId: TEAM_ID,
                    provider: "openrouter",
                    key: "secret",
                    baseUrl: "https://missing.example/v1",
                },
                async () => {
                    throw new Error("ENOTFOUND");
                },
            ),
        ).rejects.toThrow(/could not be resolved/i);
        expect(query).not.toHaveBeenCalled();
    });
});
