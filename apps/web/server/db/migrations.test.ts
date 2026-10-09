import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATIONS_DIR = path.join(process.cwd(), "server/db/migrations");
const JOURNAL_PATH = path.join(MIGRATIONS_DIR, "meta/_journal.json");

interface IJournalEntry {
    idx: number;
    tag: string;
}

interface IJournal {
    entries: IJournalEntry[];
}

function journal(): IJournal {
    return JSON.parse(readFileSync(JOURNAL_PATH, "utf8")) as IJournal;
}

describe("database migration journal", () => {
    it("has a SQL file and latest snapshot for every journal entry", () => {
        const files = new Set(readdirSync(MIGRATIONS_DIR));
        const snapshots = new Set(
            readdirSync(path.join(MIGRATIONS_DIR, "meta")),
        );

        for (const entry of journal().entries) {
            expect(files.has(`${entry.tag}.sql`), entry.tag).toBe(true);
            expect(
                snapshots.has(`${entry.tag.slice(0, 4)}_snapshot.json`),
                entry.tag,
            ).toBe(true);
        }
    });

    it("orders audio transcript migrations before STT metric extensions", () => {
        const tags = journal().entries.map((entry) => entry.tag);

        expect(tags.indexOf("0027_add_audio_transcripts")).toBeLessThan(
            tags.indexOf("0028_bright_sabra"),
        );
        expect(tags.indexOf("0028_bright_sabra")).toBeLessThan(
            tags.indexOf("0029_familiar_scarlet_spider"),
        );
        expect(tags.indexOf("0029_familiar_scarlet_spider")).toBeLessThan(
            tags.indexOf("0030_clammy_magik"),
        );
    });

    it("backfills OpenRouter Gemini audio-understanding rows with their own route id", () => {
        const migration = readFileSync(
            path.join(MIGRATIONS_DIR, "0028_bright_sabra.sql"),
            "utf8",
        );
        const routeBackfill = migration.slice(
            migration.indexOf('"route_id" = CASE'),
            migration.indexOf('"canonical_model_id" = CASE'),
        );

        expect(
            routeBackfill.indexOf("openrouter:google/gemini%"),
        ).toBeGreaterThan(-1);
        expect(routeBackfill.indexOf("openrouter:google/gemini%")).toBeLessThan(
            routeBackfill.indexOf("openrouter:%"),
        );
        expect(routeBackfill).toContain(
            "'openrouter-audio-understanding-unverified'",
        );
    });

    it("creates the project-scoped, DAG-ready workflow schema", () => {
        const migration = readFileSync(
            path.join(MIGRATIONS_DIR, "0040_amused_thaddeus_ross.sql"),
            "utf8",
        );

        expect(migration).toContain(
            `CREATE TYPE "public"."run_target" AS ENUM('single_item', 'dataset')`,
        );
        expect(migration).toContain(
            `CREATE TABLE IF NOT EXISTS "prompt_workflows"`,
        );
        expect(migration).toContain(`"archived_at" timestamp with time zone`);
        expect(migration).toContain(
            `CREATE TABLE IF NOT EXISTS "workflow_nodes"`,
        );
        expect(migration).toContain(
            `CREATE TABLE IF NOT EXISTS "workflow_edges"`,
        );
        expect(migration).toContain(
            `CREATE TABLE IF NOT EXISTS "workflow_runs"`,
        );
        expect(migration).toContain(
            `CREATE TABLE IF NOT EXISTS "workflow_run_cells"`,
        );
        expect(migration).toContain(
            `CREATE TABLE IF NOT EXISTS "workflow_cell_scores"`,
        );
        expect(migration).toContain(`"project_id" uuid NOT NULL`);
        expect(migration).toContain(
            `CONSTRAINT "workflow_nodes_workflow_id_id_unique" UNIQUE("workflow_id","id")`,
        );
        expect(migration).toContain(
            `"workflow_edges_from_node_workflow_fk" FOREIGN KEY ("workflow_id","from_node_id") REFERENCES "public"."workflow_nodes"("workflow_id","id")`,
        );
        expect(migration).toContain(
            `"workflow_edges_to_node_workflow_fk" FOREIGN KEY ("workflow_id","to_node_id") REFERENCES "public"."workflow_nodes"("workflow_id","id")`,
        );
        expect(migration).toContain(
            `"workflow_run_cells_workflow_run_id_dataset_item_id_node_key_unique"`,
        );
        expect(migration).toContain(`"claimed_at" timestamp with time zone`);
        expect(migration).toContain(
            `"workflow_run_cells_lookup_idx" ON "workflow_run_cells" USING btree ("workflow_run_id","dataset_item_id","node_key")`,
        );
        expect(migration).toContain(`"scorer_type" "scorer_type" NOT NULL`);
    });

    it("stores workflow STT preparation and scores outside prompt cells", () => {
        const migration = readFileSync(
            path.join(MIGRATIONS_DIR, "0042_workflow_run_item_scores.sql"),
            "utf8",
        );

        expect(migration).toContain(
            `CREATE TABLE IF NOT EXISTS "workflow_run_items"`,
        );
        expect(migration).toContain(
            `UNIQUE("workflow_run_id","dataset_item_id")`,
        );
        expect(migration).toContain(`"lease_owner" text`);
        expect(migration).toContain(`"claimed_at" timestamp with time zone`);
        expect(migration).toContain(
            `CREATE TABLE IF NOT EXISTS "workflow_run_item_scores"`,
        );
        expect(migration).toContain(
            `UNIQUE("workflow_run_item_id","scorer_type")`,
        );
        expect(migration).toContain(`ON DELETE cascade`);
        expect(migration).not.toContain(`ALTER TABLE "run_cells"`);
    });

    it("timestamps V1 cell claims for stale-worker recovery", () => {
        const migration = readFileSync(
            path.join(MIGRATIONS_DIR, "0047_optimal_the_captain.sql"),
            "utf8",
        );

        expect(migration).toContain(
            `ALTER TABLE "run_cells" ADD COLUMN "claimed_at" timestamp with time zone`,
        );
        expect(migration).toContain(
            `UPDATE "run_cells" SET "claimed_at" = now() WHERE "status" = 'running'`,
        );
    });

    it("backfills and constrains workflow node model ids", () => {
        const migration = readFileSync(
            path.join(MIGRATIONS_DIR, "0045_soft_arclight.sql"),
            "utf8",
        );

        expect(migration).toContain(
            `SET "model_id" = "node_config"->'sttConfig'->>'modelId'`,
        );
        expect(migration).toContain(
            `SET "model_id" = "node_config"->'transliteration'->>'modelId'`,
        );
        expect(migration).toContain(
            `WHERE "node_type" <> 'metric_compare' AND "model_id" IS NULL`,
        );
        expect(migration).toContain(
            `CHECK ("workflow_nodes"."node_type" = 'metric_compare' or "workflow_nodes"."model_id" is not null)`,
        );
    });

    it("stores project-scoped STT route probes with constrained statuses", () => {
        const migration = readFileSync(
            path.join(MIGRATIONS_DIR, "0046_late_chronomancer.sql"),
            "utf8",
        );

        expect(migration).toContain(
            `CREATE TABLE IF NOT EXISTS "stt_route_probes"`,
        );
        expect(migration).toContain(`"team_id" uuid NOT NULL`);
        expect(migration).toContain(`"project_id" uuid NOT NULL`);
        expect(migration).toContain(
            `CHECK ("status" in ('available', 'failed', 'unsupported_input'))`,
        );
        expect(migration).toContain(
            `"stt_route_probes_team_project_model_idx"`,
        );
    });

    it("persists project-scoped immutable LLM routing and durable enqueue state", () => {
        const migration = readFileSync(
            path.join(MIGRATIONS_DIR, "0051_add_llm_execution_routing.sql"),
            "utf8",
        );

        expect(migration).toContain(`CREATE TABLE IF NOT EXISTS "llm_routes"`);
        expect(migration).toContain(
            `CREATE TABLE IF NOT EXISTS "llm_route_versions"`,
        );
        expect(migration).toContain(
            `CREATE TABLE IF NOT EXISTS "llm_capability_versions"`,
        );
        expect(migration).toContain(
            `CREATE TABLE IF NOT EXISTS "workflow_cell_attempts"`,
        );
        expect(migration).toContain(
            `CREATE TABLE IF NOT EXISTS "workflow_exact_reuse"`,
        );
        expect(migration).toContain(
            `CREATE TABLE IF NOT EXISTS "workflow_run_enqueue_outbox"`,
        );
        expect(migration).toContain(`"rotation_version" uuid`);
        expect(migration).toContain(`"llm_selection_mode" text`);
        expect(migration).toContain(`"llm_route_version_id" uuid`);
        expect(migration).toContain(
            `UNIQUE("project_id","fingerprint_version","fingerprint")`,
        );
        expect(migration).toContain(
            `CREATE TRIGGER llm_route_versions_immutable`,
        );
        expect(migration).toContain(
            `CREATE TRIGGER workflow_cell_attempts_immutable`,
        );
        expect(migration).toContain(
            `"workflow_run_enqueue_outbox_run_scope_fk"`,
        );
        expect(migration).toContain(
            `CREATE TRIGGER llm_route_versions_provider_key_scope`,
        );
        expect(migration).not.toContain(
            `"llm_route_versions_provider_key_scope_fk"`,
        );
        expect(migration).toContain(`DEFAULT 'legacy_unresolved' NOT NULL`);
        expect(migration).toContain(
            `ALTER COLUMN "enqueue_status" SET DEFAULT 'pending_enqueue'`,
        );
        expect(
            migration.indexOf(
                `ALTER TABLE "projects" ADD CONSTRAINT "projects_team_id_id_unique"`,
            ),
        ).toBeLessThan(
            migration.indexOf(
                `ADD CONSTRAINT "llm_capability_versions_team_project_fk"`,
            ),
        );
        expect(
            migration.indexOf(
                `ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_project_id_id_unique"`,
            ),
        ).toBeLessThan(
            migration.indexOf(
                `ADD CONSTRAINT "workflow_run_enqueue_outbox_run_scope_fk"`,
            ),
        );
        expect(migration).not.toContain(
            `UPDATE "workflow_nodes" SET "llm_route_version_id"`,
        );
    });

    it("hardens routing selection, key rotation, and outbox claims", () => {
        const migration = readFileSync(
            path.join(MIGRATIONS_DIR, "0053_flashy_falcon.sql"),
            "utf8",
        );

        expect(migration).toContain(
            `CHECK (coalesce(("workflow_nodes"."llm_selection_mode" is null`,
        );
        expect(migration).toContain(`'publishing'`);
        expect(migration).toContain(
            `CREATE TRIGGER provider_keys_rotate_version`,
        );
        expect(migration).toContain(
            `BEFORE UPDATE OF ciphertext, iv, auth_tag, base_url`,
        );
        expect(migration).toContain(`llm_capability_versions_latest_model_idx`);
    });
});
