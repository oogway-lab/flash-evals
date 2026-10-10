# MCP real-backend acceptance coverage

This ledger distinguishes catalog/profile checks from calls that reached the shared business logic and PostgreSQL. It does not treat registration, annotations, mocks, or a skipped test as backend evidence.

## Current evidence

- The independent MCP policy suite passed on Node 24.21.0: `policyCoverage.acceptance.test.ts` observed the protocol catalog and profile-specific tool lists for all 84 tools (29 read, 45 eval-only, 10 admin-only), plus all eight resource templates and the `create_eval_happy_path` prompt.
- `realBackend.acceptance.test.ts` is written to call the actual HTTP MCP endpoint implementation, raw synthetic token auth, shared route handlers, PostgreSQL, and temporary local storage. It contains positive scenarios for 15 tools, eight resource-template reads, one prompt read, tenant-scoped 404, origin 403, schema rejection, high-precision paging, concurrent idempotent copy, replay after a deliberately discarded client response, and persisted image bytes.
- The real-backend suite was **not executed** here: Docker access was denied, and local `initdb` failed because this executor denied PostgreSQL shared-memory creation (`shmget: Operation not permitted`). Port 5432 was left untouched. Therefore the scenarios below are harness-authored, not passing backend evidence.
- No new runtime bug was confirmed. The known timestamp-cursor, resource-error-shape, paid prompt/provider effects, and ambiguous save-outcome issues still need verification against the implementation worker’s fixed head.

## Run against a disposable local database

Use an approved PostgreSQL service on loopback with database `flash_evals_mcp_acceptance`; keep any other local database and port untouched. Apply the app migrations, then run:

```sh
DATABASE_URL="postgres://USER:PASSWORD@127.0.0.1:PORT/flash_evals_mcp_acceptance" pnpm --filter @mosaic/web db:migrate
MOSAIC_MCP_ACCEPTANCE_DATABASE_URL="postgres://USER:PASSWORD@127.0.0.1:PORT/flash_evals_mcp_acceptance" pnpm --filter @mosaic/api exec vitest run src/mcp/realBackend.acceptance.test.ts
```

The test refuses a non-loopback host or a database with another name. It creates only synthetic teams, users, a raw MCP token, workspaces, projects, datasets, and result fixtures, and removes those rows plus its temporary upload directory in `afterAll`. It makes no paid provider request and does not read production credentials. The response-replay case discards a successful response at the client edge; it does not simulate a socket failure after commit.

## Tool-level ledger

| Tool                                  | Real-backend scenario                                        | Execution status                |
| ------------------------------------- | ------------------------------------------------------------ | ------------------------------- |
| `list_workspaces`                     | Not authored in current real-backend harness                 | Unexercised                     |
| `create_workspace`                    | Acceptance test call plus returned/persisted-state assertion | Not run: PostgreSQL unavailable |
| `rename_workspace`                    | Acceptance test call plus returned/persisted-state assertion | Not run: PostgreSQL unavailable |
| `get_current_user`                    | Acceptance test call plus returned/persisted-state assertion | Not run: PostgreSQL unavailable |
| `list_eval_context`                   | Not authored in current real-backend harness                 | Unexercised                     |
| `list_projects`                       | Acceptance test call plus returned/persisted-state assertion | Not run: PostgreSQL unavailable |
| `create_project`                      | Acceptance test call plus returned/persisted-state assertion | Not run: PostgreSQL unavailable |
| `update_project`                      | Acceptance test call plus returned/persisted-state assertion | Not run: PostgreSQL unavailable |
| `get_dashboard`                       | Not authored in current real-backend harness                 | Unexercised                     |
| `list_datasets`                       | Acceptance test call plus returned/persisted-state assertion | Not run: PostgreSQL unavailable |
| `get_dataset`                         | Acceptance test call plus returned/persisted-state assertion | Not run: PostgreSQL unavailable |
| `get_dataset_summary`                 | Acceptance test call plus returned/persisted-state assertion | Not run: PostgreSQL unavailable |
| `list_dataset_items`                  | Acceptance test call plus returned/persisted-state assertion | Not run: PostgreSQL unavailable |
| `create_dataset`                      | Acceptance test call plus returned/persisted-state assertion | Not run: PostgreSQL unavailable |
| `import_dataset_images`               | Not authored in current real-backend harness                 | Unexercised                     |
| `import_dataset_text_items`           | Acceptance test call plus returned/persisted-state assertion | Not run: PostgreSQL unavailable |
| `import_dataset_golden_answers`       | Not authored in current real-backend harness                 | Unexercised                     |
| `preview_dataset_golden_answers`      | Not authored in current real-backend harness                 | Unexercised                     |
| `commit_dataset_golden_answers`       | Not authored in current real-backend harness                 | Unexercised                     |
| `import_dataset_image_answers`        | Not authored in current real-backend harness                 | Unexercised                     |
| `import_dataset_paired_items`         | Not authored in current real-backend harness                 | Unexercised                     |
| `add_dataset_item`                    | Acceptance test call plus returned/persisted-state assertion | Not run: PostgreSQL unavailable |
| `update_dataset_item`                 | Acceptance test call plus returned/persisted-state assertion | Not run: PostgreSQL unavailable |
| `delete_dataset_item`                 | Not authored in current real-backend harness                 | Unexercised                     |
| `delete_dataset_label`                | Not authored in current real-backend harness                 | Unexercised                     |
| `rename_dataset`                      | Not authored in current real-backend harness                 | Unexercised                     |
| `update_dataset_description`          | Not authored in current real-backend harness                 | Unexercised                     |
| `set_dataset_archived`                | Not authored in current real-backend harness                 | Unexercised                     |
| `duplicate_dataset`                   | Acceptance test call plus returned/persisted-state assertion | Not run: PostgreSQL unavailable |
| `delete_dataset`                      | Not authored in current real-backend harness                 | Unexercised                     |
| `import_dataset_audio`                | Not authored in current real-backend harness                 | Unexercised                     |
| `import_dataset_audio_answers`        | Not authored in current real-backend harness                 | Unexercised                     |
| `list_prompts`                        | Not authored in current real-backend harness                 | Unexercised                     |
| `get_prompt`                          | Not authored in current real-backend harness                 | Unexercised                     |
| `generate_schema_from_prompt`         | Not authored in current real-backend harness                 | Unexercised                     |
| `test_prompt_draft`                   | Not authored in current real-backend harness                 | Unexercised                     |
| `validate_runnable_prompt`            | Not authored in current real-backend harness                 | Unexercised                     |
| `create_runnable_prompt`              | Not authored in current real-backend harness                 | Unexercised                     |
| `optimize_prompt`                     | Not authored in current real-backend harness                 | Unexercised                     |
| `test_judge_draft`                    | Not authored in current real-backend harness                 | Unexercised                     |
| `generate_judge_for_run`              | Not authored in current real-backend harness                 | Unexercised                     |
| `create_judge_prompt`                 | Not authored in current real-backend harness                 | Unexercised                     |
| `duplicate_prompt_version`            | Not authored in current real-backend harness                 | Unexercised                     |
| `delete_prompt`                       | Not authored in current real-backend harness                 | Unexercised                     |
| `list_runs`                           | Not authored in current real-backend harness                 | Unexercised                     |
| `get_run`                             | Not authored in current real-backend harness                 | Unexercised                     |
| `get_run_progress`                    | Not authored in current real-backend harness                 | Unexercised                     |
| `get_run_summary`                     | Not authored in current real-backend harness                 | Unexercised                     |
| `list_run_cells`                      | Not authored in current real-backend harness                 | Unexercised                     |
| `create_eval_run`                     | Not authored in current real-backend harness                 | Unexercised                     |
| `save_run_note`                       | Not authored in current real-backend harness                 | Unexercised                     |
| `annotate_run_cell`                   | Not authored in current real-backend harness                 | Unexercised                     |
| `retry_run`                           | Not authored in current real-backend harness                 | Unexercised                     |
| `delete_run`                          | Not authored in current real-backend harness                 | Unexercised                     |
| `list_workflows`                      | Not authored in current real-backend harness                 | Unexercised                     |
| `get_workflow`                        | Not authored in current real-backend harness                 | Unexercised                     |
| `create_workflow`                     | Not authored in current real-backend harness                 | Unexercised                     |
| `create_multiworkflow`                | Not authored in current real-backend harness                 | Unexercised                     |
| `update_workflow`                     | Not authored in current real-backend harness                 | Unexercised                     |
| `delete_workflow`                     | Not authored in current real-backend harness                 | Unexercised                     |
| `select_workflow_llm_model`           | Not authored in current real-backend harness                 | Unexercised                     |
| `create_workflow_run`                 | Not authored in current real-backend harness                 | Unexercised                     |
| `list_workflow_runs`                  | Not authored in current real-backend harness                 | Unexercised                     |
| `get_workflow_run`                    | Not authored in current real-backend harness                 | Unexercised                     |
| `get_workflow_run_summary`            | Not authored in current real-backend harness                 | Unexercised                     |
| `list_workflow_run_cells`             | Not authored in current real-backend harness                 | Unexercised                     |
| `save_workflow_run_note`              | Not authored in current real-backend harness                 | Unexercised                     |
| `annotate_workflow_run_cell`          | Not authored in current real-backend harness                 | Unexercised                     |
| `get_workflow_run_progress`           | Not authored in current real-backend harness                 | Unexercised                     |
| `list_provider_keys`                  | Not authored in current real-backend harness                 | Unexercised                     |
| `set_provider_key`                    | Not authored in current real-backend harness                 | Unexercised                     |
| `clear_provider_key`                  | Not authored in current real-backend harness                 | Unexercised                     |
| `create_stt_route_probe`              | Not authored in current real-backend harness                 | Unexercised                     |
| `list_workflow_llm_capabilities`      | Not authored in current real-backend harness                 | Unexercised                     |
| `refresh_workflow_llm_capabilities`   | Not authored in current real-backend harness                 | Unexercised                     |
| `list_workflow_llm_routes`            | Not authored in current real-backend harness                 | Unexercised                     |
| `list_workflow_llm_provider_models`   | Not authored in current real-backend harness                 | Unexercised                     |
| `list_workflow_llm_route_history`     | Not authored in current real-backend harness                 | Unexercised                     |
| `create_workflow_llm_route_version`   | Not authored in current real-backend harness                 | Unexercised                     |
| `create_workflow_llm_route_for_model` | Not authored in current real-backend harness                 | Unexercised                     |
| `disable_workflow_llm_route`          | Not authored in current real-backend harness                 | Unexercised                     |
| `get_workflow_llm_default`            | Not authored in current real-backend harness                 | Unexercised                     |
| `set_workflow_llm_default`            | Not authored in current real-backend harness                 | Unexercised                     |
| `clear_workflow_llm_default`          | Not authored in current real-backend harness                 | Unexercised                     |

## Other protocol coverage

| Surface                | Expected rows | Harness / evidence                                                                                                                      | Status                                                                 |
| ---------------------- | ------------: | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| MCP resource templates |             8 | Reads dataset, prompt, run, model, bounded dataset summary/items, bounded run summary/cells.                                            | Authored; not run against PostgreSQL                                   |
| MCP prompt             |             1 | Reads `create_eval_happy_path` through `prompts/get`.                                                                                   | Authored; protocol-only policy test passed                             |
| Tenant/error paths     |             3 | Tool-call cross-tenant 404, resource cross-tenant 404 JSON-RPC error, denied HTTP origin 403.                                           | Authored; not run against PostgreSQL                                   |
| Invalid tool input     |             1 | Invalid dataset modality rejected by MCP schema validation.                                                                             | Authored; not run against PostgreSQL                                   |
| Storage                |             1 | Adds a synthetic PNG, checks DB storage key and byte-for-byte file persistence in a disposable directory.                               | Authored; not run against PostgreSQL                                   |
| Provider-backed tools  |            13 | Schema generation, prompt/judge tests, eval/workflow execution, STT probe, live provider model/capability discovery and route creation. | Unexercised; no external paid-provider mock adapter is implemented yet |
| Copy/idempotency       |             1 | Concurrent duplicate calls with one key and retry after intentionally discarded successful response.                                    | Authored; not run against PostgreSQL                                   |
| Other recovery         |             — | Idempotency conflict with changed request, true socket loss, expensive-call recovery, retry state transition.                           | Unexercised                                                            |

The test inventory is a correctness gate only for catalog/profile access. It is not a claim of 84/84 business E2E coverage; the remaining tool rows above are explicitly unexercised until real calls and persistence assertions produce evidence.
