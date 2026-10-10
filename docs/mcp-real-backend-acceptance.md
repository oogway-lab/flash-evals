# MCP real-backend acceptance coverage

This ledger distinguishes catalog/profile checks from operations that reached the MCP HTTP handler, shared business logic, and PostgreSQL. Assertions are based on response data and persisted synthetic rows, not handler mocks or annotations.

## Evidence on the reconciled implementation head

- The independent policy suite lists and checks all 88 tools for the read/eval/admin profiles, using explicitly maintained expected tool sets (33 read, 78 eval, 88 admin). It exercises the real MCP SDK over stdio with synthetic auth/runtime fixtures; its database adapter is not PostgreSQL.
- The real-backend suite calls actual JSON-RPC `tools/call`, `resources/read`, and `prompts/get` requests through `handleMcpRequest`, real MCP registration/auth, shared business handlers, PostgreSQL 16, and temporary local storage. The raw bearer token and all rows/files are synthetic.
- Against the exact reconciled implementation head `5d99bc73ecbb6e0937a4466181f3565869bc6aa0`, all 10 real-backend scenarios passed. The harness has meaningful result/state assertions for all 88 registered tools, including the four bounded summary-page tools added on the rebased upstream main. The microsecond cursor regression is covered with `.123456Z` and `.654321Z` PostgreSQL timestamps, and cross-tenant resource reads return a JSON-RPC error.
- The provider adapter intercepts and supplies deterministic responses for OpenAI model listing, chat completions, and audio transcriptions. It throws on every other provider/network endpoint. Prompt validation/generation, optimization, judge generation/testing, STT probe persistence, and LLM route discovery/mutations therefore exercise real shared code and PostgreSQL without external provider calls or charges.
- The completed real-backend run reported 10 passing scenarios (10 total) on Node 24.21.0. The full MCP test directory passed on this test branch: 17 files passed, 2 skipped; 169 tests passed, 12 skipped. The no-DB invocation skips the DB-gated real-backend suite.

## Run the real-backend suite

Use a dedicated disposable PostgreSQL 16 database on loopback named `flash_evals_mcp_acceptance`; do not point this suite at a persistent development or production database. Apply migrations and run:

```sh
DATABASE_URL="$DISPOSABLE_DATABASE_URL" pnpm --filter @mosaic/web db:migrate
pnpm --filter @mosaic/api build
MOSAIC_MCP_ACCEPTANCE_DATABASE_URL="$DISPOSABLE_DATABASE_URL" pnpm --filter @mosaic/api exec vitest run src/mcp/realBackend.acceptance.test.ts
```

The test refuses non-loopback hosts and any database name other than `flash_evals_mcp_acceptance`. It runs no paid provider calls. Temporary uploaded files are removed in `afterAll`. If workflow LLM route versions were created, PostgreSQL immutability triggers prevent deleting that history and its referenced fixture graph; discard the dedicated database/container after the run, as required by `CONTRIBUTING.md`.

## Real-backend scenario ledger

| Scenario                                                                                                     | Result |
| ------------------------------------------------------------------------------------------------------------ | ------ |
| Creates and reads tenant-owned workspaces, projects, and datasets; cursor paging and copy idempotency        | Pass   |
| Reads tenant workspace, eval setup, and dashboard state from PostgreSQL                                      | Pass   |
| Exercises workflow CRUD, durable run creation, readers, summaries, and review mutations                      | Pass   |
| Sets and clears only a synthetic provider key and reads routing metadata                                     | Pass   |
| Exercises provider-backed tools with deterministic local responses and no outbound provider requests         | Pass   |
| Imports golden answers and exercises dataset rename, archive, label, item, and delete operations             | Pass   |
| Imports image/audio fixtures and previews and commits mapped audio answers                                   | Pass   |
| Persists synthetic image bytes to temporary local storage and verifies byte-for-byte contents                | Pass   |
| Reads all resource URIs and the setup prompt; checks blocked-origin HTTP 403 and cross-tenant resource error | Pass   |
| Checks invalid schema input and tenant-scoped tool not-found errors                                          | Pass   |

## Tool-level real-backend ledger

| Tool                                  | Scenario                                                                                              | Evidence on exact head `5d99bc73`                                                      |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `list_workspaces`                     | reads tenant workspace, eval setup, and dashboard state from PostgreSQL                               | Pass; positive result/output state or persisted rows asserted through real tools/call. |
| `create_workspace`                    | creates and reads tenant-owned workspaces, projects, and datasets through tools/call                  | Pass; positive result/output state or persisted rows asserted through real tools/call. |
| `rename_workspace`                    | creates and reads tenant-owned workspaces, projects, and datasets through tools/call                  | Pass; positive result/output state or persisted rows asserted through real tools/call. |
| `get_current_user`                    | creates and reads tenant-owned workspaces, projects, and datasets through tools/call                  | Pass; positive result/output state or persisted rows asserted through real tools/call. |
| `list_eval_context`                   | reads tenant workspace, eval setup, and dashboard state from PostgreSQL                               | Pass; positive result/output state or persisted rows asserted through real tools/call. |
| `list_projects`                       | creates and reads tenant-owned workspaces, projects, and datasets through tools/call                  | Pass; positive result/output state or persisted rows asserted through real tools/call. |
| `create_project`                      | creates and reads tenant-owned workspaces, projects, and datasets through tools/call                  | Pass; positive result/output state or persisted rows asserted through real tools/call. |
| `update_project`                      | creates and reads tenant-owned workspaces, projects, and datasets through tools/call                  | Pass; positive result/output state or persisted rows asserted through real tools/call. |
| `get_dashboard`                       | reads tenant workspace, eval setup, and dashboard state from PostgreSQL                               | Pass; positive result/output state or persisted rows asserted through real tools/call. |
| `list_datasets`                       | creates and reads tenant-owned workspaces, projects, and datasets through tools/call                  | Pass; positive result/output state or persisted rows asserted through real tools/call. |
| `list_dataset_summaries_page`         | creates and reads tenant-owned workspaces, projects, and datasets through tools/call                  | Pass; page includes the created dataset, item count, modality, and completion state.   |
| `get_dataset`                         | creates and reads tenant-owned workspaces, projects, and datasets through tools/call                  | Pass; positive result/output state or persisted rows asserted through real tools/call. |
| `get_dataset_summary`                 | creates and reads tenant-owned workspaces, projects, and datasets through tools/call                  | Pass; positive result/output state or persisted rows asserted through real tools/call. |
| `list_dataset_items`                  | creates and reads tenant-owned workspaces, projects, and datasets through tools/call                  | Pass; `.123456Z` and `.654321Z` rows appear once each on distinct pages.               |
| `create_dataset`                      | creates and reads tenant-owned workspaces, projects, and datasets through tools/call                  | Pass; positive result/output state or persisted rows asserted through real tools/call. |
| `import_dataset_images`               | imports image and audio files and previews and commits mapped audio answers                           | Pass; positive result/output state or persisted rows asserted through real tools/call. |
| `import_dataset_text_items`           | creates and reads tenant-owned workspaces, projects, and datasets through tools/call                  | Pass; positive result/output state or persisted rows asserted through real tools/call. |
| `import_dataset_golden_answers`       | imports golden answers and exercises dataset rename, archive, label, item, and delete operations      | Pass; positive result/output state or persisted rows asserted through real tools/call. |
| `preview_dataset_golden_answers`      | imports image and audio files and previews and commits mapped audio answers                           | Pass; positive result/output state or persisted rows asserted through real tools/call. |
| `commit_dataset_golden_answers`       | imports image and audio files and previews and commits mapped audio answers                           | Pass; positive result/output state or persisted rows asserted through real tools/call. |
| `import_dataset_image_answers`        | imports image and audio files and previews and commits mapped audio answers                           | Pass; positive result/output state or persisted rows asserted through real tools/call. |
| `import_dataset_paired_items`         | imports image and audio files and previews and commits mapped audio answers                           | Pass; positive result/output state or persisted rows asserted through real tools/call. |
| `add_dataset_item`                    | imports golden answers and exercises dataset rename, archive, label, item, and delete operations      | Pass; positive result/output state or persisted rows asserted through real tools/call. |
| `update_dataset_item`                 | persists image bytes to disposable local storage and returns their stored metadata                    | Pass; positive result/output state or persisted rows asserted through real tools/call. |
| `delete_dataset_item`                 | imports golden answers and exercises dataset rename, archive, label, item, and delete operations      | Pass; positive result/output state or persisted rows asserted through real tools/call. |
| `delete_dataset_label`                | imports golden answers and exercises dataset rename, archive, label, item, and delete operations      | Pass; positive result/output state or persisted rows asserted through real tools/call. |
| `rename_dataset`                      | imports golden answers and exercises dataset rename, archive, label, item, and delete operations      | Pass; positive result/output state or persisted rows asserted through real tools/call. |
| `update_dataset_description`          | imports golden answers and exercises dataset rename, archive, label, item, and delete operations      | Pass; positive result/output state or persisted rows asserted through real tools/call. |
| `set_dataset_archived`                | imports golden answers and exercises dataset rename, archive, label, item, and delete operations      | Pass; positive result/output state or persisted rows asserted through real tools/call. |
| `duplicate_dataset`                   | creates and reads tenant-owned workspaces, projects, and datasets through tools/call                  | Pass; positive result/output state or persisted rows asserted through real tools/call. |
| `delete_dataset`                      | imports golden answers and exercises dataset rename, archive, label, item, and delete operations      | Pass; positive result/output state or persisted rows asserted through real tools/call. |
| `import_dataset_audio`                | imports image and audio files and previews and commits mapped audio answers                           | Pass; positive result/output state or persisted rows asserted through real tools/call. |
| `import_dataset_audio_answers`        | imports image and audio files and previews and commits mapped audio answers                           | Pass; positive result/output state or persisted rows asserted through real tools/call. |
| `list_prompts`                        | roundtrips the eight resource templates, one setup prompt, HTTP 403, and resource 404 protocol errors | Pass; positive result/output state or persisted rows asserted through real tools/call. |
| `get_prompt`                          | roundtrips the eight resource templates, one setup prompt, HTTP 403, and resource 404 protocol errors | Pass; positive result/output state or persisted rows asserted through real tools/call. |
| `generate_schema_from_prompt`         | runs provider-backed MCP tools through a deterministic no-network adapter                             | Pass; positive result/output state or persisted rows asserted through real tools/call. |
| `test_prompt_draft`                   | runs provider-backed MCP tools through a deterministic no-network adapter                             | Pass; positive result/output state or persisted rows asserted through real tools/call. |
| `validate_runnable_prompt`            | runs provider-backed MCP tools through a deterministic no-network adapter                             | Pass; positive result/output state or persisted rows asserted through real tools/call. |
| `create_runnable_prompt`              | runs provider-backed MCP tools through a deterministic no-network adapter                             | Pass; positive result/output state or persisted rows asserted through real tools/call. |
| `optimize_prompt`                     | runs provider-backed MCP tools through a deterministic no-network adapter                             | Pass; positive result/output state or persisted rows asserted through real tools/call. |
| `test_judge_draft`                    | runs provider-backed MCP tools through a deterministic no-network adapter                             | Pass; positive result/output state or persisted rows asserted through real tools/call. |
| `generate_judge_for_run`              | runs provider-backed MCP tools through a deterministic no-network adapter                             | Pass; positive result/output state or persisted rows asserted through real tools/call. |
| `create_judge_prompt`                 | roundtrips the eight resource templates, one setup prompt, HTTP 403, and resource 404 protocol errors | Pass; positive result/output state or persisted rows asserted through real tools/call. |
| `duplicate_prompt_version`            | roundtrips the eight resource templates, one setup prompt, HTTP 403, and resource 404 protocol errors | Pass; positive result/output state or persisted rows asserted through real tools/call. |
| `delete_prompt`                       | roundtrips the eight resource templates, one setup prompt, HTTP 403, and resource 404 protocol errors | Pass; positive result/output state or persisted rows asserted through real tools/call. |
| `list_runs`                           | roundtrips the eight resource templates, one setup prompt, HTTP 403, and resource 404 protocol errors | Pass; positive result/output state or persisted rows asserted through real tools/call. |
| `list_run_summaries_page`             | roundtrips the eight resource templates, one setup prompt, HTTP 403, and resource 404 protocol errors | Pass; summary page contains the synthetic run and its dataset metadata.                |
| `get_run`                             | roundtrips the eight resource templates, one setup prompt, HTTP 403, and resource 404 protocol errors | Pass; positive result/output state or persisted rows asserted through real tools/call. |
| `get_run_progress`                    | roundtrips the eight resource templates, one setup prompt, HTTP 403, and resource 404 protocol errors | Pass; positive result/output state or persisted rows asserted through real tools/call. |
| `get_run_summary`                     | roundtrips the eight resource templates, one setup prompt, HTTP 403, and resource 404 protocol errors | Pass; positive result/output state or persisted rows asserted through real tools/call. |
| `list_run_cells`                      | roundtrips the eight resource templates, one setup prompt, HTTP 403, and resource 404 protocol errors | Pass; positive result/output state or persisted rows asserted through real tools/call. |
| `create_eval_run`                     | roundtrips the eight resource templates, one setup prompt, HTTP 403, and resource 404 protocol errors | Pass; positive result/output state or persisted rows asserted through real tools/call. |
| `save_run_note`                       | roundtrips the eight resource templates, one setup prompt, HTTP 403, and resource 404 protocol errors | Pass; positive result/output state or persisted rows asserted through real tools/call. |
| `annotate_run_cell`                   | roundtrips the eight resource templates, one setup prompt, HTTP 403, and resource 404 protocol errors | Pass; positive result/output state or persisted rows asserted through real tools/call. |
| `retry_run`                           | roundtrips the eight resource templates, one setup prompt, HTTP 403, and resource 404 protocol errors | Pass; positive result/output state or persisted rows asserted through real tools/call. |
| `delete_run`                          | roundtrips the eight resource templates, one setup prompt, HTTP 403, and resource 404 protocol errors | Pass; positive result/output state or persisted rows asserted through real tools/call. |
| `list_workflows`                      | runs workflow CRUD, durable creation, reader, and review tools on owned rows                          | Pass; positive result/output state or persisted rows asserted through real tools/call. |
| `list_workflow_summaries_page`        | runs workflow CRUD, durable creation, reader, and review tools on owned rows                          | Pass; summary page contains the created workflow and its node count.                   |
| `get_workflow`                        | runs workflow CRUD, durable creation, reader, and review tools on owned rows                          | Pass; positive result/output state or persisted rows asserted through real tools/call. |
| `create_workflow`                     | runs workflow CRUD, durable creation, reader, and review tools on owned rows                          | Pass; positive result/output state or persisted rows asserted through real tools/call. |
| `create_multiworkflow`                | runs workflow CRUD, durable creation, reader, and review tools on owned rows                          | Pass; positive result/output state or persisted rows asserted through real tools/call. |
| `update_workflow`                     | runs workflow CRUD, durable creation, reader, and review tools on owned rows                          | Pass; positive result/output state or persisted rows asserted through real tools/call. |
| `delete_workflow`                     | runs workflow CRUD, durable creation, reader, and review tools on owned rows                          | Pass; positive result/output state or persisted rows asserted through real tools/call. |
| `select_workflow_llm_model`           | runs provider-backed MCP tools through a deterministic no-network adapter                             | Pass; positive result/output state or persisted rows asserted through real tools/call. |
| `create_workflow_run`                 | runs workflow CRUD, durable creation, reader, and review tools on owned rows                          | Pass; positive result/output state or persisted rows asserted through real tools/call. |
| `list_workflow_runs`                  | runs workflow CRUD, durable creation, reader, and review tools on owned rows                          | Pass; positive result/output state or persisted rows asserted through real tools/call. |
| `list_workflow_run_summaries_page`    | runs workflow CRUD, durable creation, reader, and review tools on owned rows                          | Pass; summary page contains the synthetic run and expected item count.                 |
| `get_workflow_run`                    | runs workflow CRUD, durable creation, reader, and review tools on owned rows                          | Pass; positive result/output state or persisted rows asserted through real tools/call. |
| `get_workflow_run_summary`            | runs workflow CRUD, durable creation, reader, and review tools on owned rows                          | Pass; positive result/output state or persisted rows asserted through real tools/call. |
| `list_workflow_run_cells`             | runs workflow CRUD, durable creation, reader, and review tools on owned rows                          | Pass; positive result/output state or persisted rows asserted through real tools/call. |
| `save_workflow_run_note`              | runs workflow CRUD, durable creation, reader, and review tools on owned rows                          | Pass; positive result/output state or persisted rows asserted through real tools/call. |
| `annotate_workflow_run_cell`          | runs workflow CRUD, durable creation, reader, and review tools on owned rows                          | Pass; positive result/output state or persisted rows asserted through real tools/call. |
| `get_workflow_run_progress`           | runs workflow CRUD, durable creation, reader, and review tools on owned rows                          | Pass; positive result/output state or persisted rows asserted through real tools/call. |
| `list_provider_keys`                  | sets and clears only a synthetic provider key and reads route metadata                                | Pass; positive result/output state or persisted rows asserted through real tools/call. |
| `set_provider_key`                    | sets and clears only a synthetic provider key and reads route metadata                                | Pass; positive result/output state or persisted rows asserted through real tools/call. |
| `clear_provider_key`                  | sets and clears only a synthetic provider key and reads route metadata                                | Pass; positive result/output state or persisted rows asserted through real tools/call. |
| `create_stt_route_probe`              | runs provider-backed MCP tools through a deterministic no-network adapter                             | Pass; positive result/output state or persisted rows asserted through real tools/call. |
| `list_workflow_llm_capabilities`      | sets and clears only a synthetic provider key and reads route metadata                                | Pass; positive result/output state or persisted rows asserted through real tools/call. |
| `refresh_workflow_llm_capabilities`   | runs provider-backed MCP tools through a deterministic no-network adapter                             | Pass; positive result/output state or persisted rows asserted through real tools/call. |
| `list_workflow_llm_routes`            | sets and clears only a synthetic provider key and reads route metadata                                | Pass; positive result/output state or persisted rows asserted through real tools/call. |
| `list_workflow_llm_provider_models`   | runs provider-backed MCP tools through a deterministic no-network adapter                             | Pass; positive result/output state or persisted rows asserted through real tools/call. |
| `list_workflow_llm_route_history`     | runs provider-backed MCP tools through a deterministic no-network adapter                             | Pass; positive result/output state or persisted rows asserted through real tools/call. |
| `create_workflow_llm_route_version`   | runs provider-backed MCP tools through a deterministic no-network adapter                             | Pass; positive result/output state or persisted rows asserted through real tools/call. |
| `create_workflow_llm_route_for_model` | runs provider-backed MCP tools through a deterministic no-network adapter                             | Pass; positive result/output state or persisted rows asserted through real tools/call. |
| `disable_workflow_llm_route`          | runs provider-backed MCP tools through a deterministic no-network adapter                             | Pass; positive result/output state or persisted rows asserted through real tools/call. |
| `get_workflow_llm_default`            | sets and clears only a synthetic provider key and reads route metadata                                | Pass; positive result/output state or persisted rows asserted through real tools/call. |
| `set_workflow_llm_default`            | runs provider-backed MCP tools through a deterministic no-network adapter                             | Pass; positive result/output state or persisted rows asserted through real tools/call. |
| `clear_workflow_llm_default`          | sets and clears only a synthetic provider key and reads route metadata                                | Pass; positive result/output state or persisted rows asserted through real tools/call. |

## Other protocol and safety evidence

| Surface                    | Expected / observed                      | Evidence                                                                                                                    | Status on exact head `5d99bc73`                                                           |
| -------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Resource templates         | 4 legacy resources + 4 bounded templates | Reads all eight registered dataset, prompt, run, model, summary, and paged resource URIs.                                   | Pass; all JSON payloads parse and foreign-tenant reads return a sanitized JSON-RPC error. |
| Prompt                     | 1                                        | Reads `create_eval_happy_path` via `prompts/get`.                                                                           | Pass                                                                                      |
| Tenant tool error          | 404                                      | Reads a foreign project dataset using an authenticated synthetic principal.                                                 | Pass; sanitized tool-call error status asserted.                                          |
| Resource tenant error      | 404 JSON-RPC error                       | Reads a foreign project resource as an authenticated synthetic principal.                                                   | Pass; `resources/read` returns protocol `error` without leaking tool-result fields.       |
| HTTP origin boundary       | 403                                      | Sends both `tools/list` and `resources/read` with a disallowed synthetic Origin.                                            | Pass.                                                                                     |
| Invalid tool input         | 1                                        | Sends an invalid dataset modality through `tools/call`.                                                                     | Pass; returns tool error.                                                                 |
| Storage                    | 1                                        | Adds a synthetic PNG and checks database storage metadata and byte-for-byte local file contents.                            | Pass                                                                                      |
| Copy/idempotency           | 1                                        | Concurrent `duplicate_dataset` requests with one key; another success response is discarded at the client edge and retried. | Pass; same returned ID and one persisted copy.                                            |
| Retry / run recovery       | 1                                        | Creates eval run, retries a synthetic run, and checks persisted status and deletion.                                        | Pass; queue publication may be queued or pending for retry.                               |
| Provider-boundary recovery | —                                        | No true socket disconnect after provider response; no paid-provider retry/replay is attempted.                              | Not exercised.                                                                            |

The old base `48c0ee77f32119f29523dc1322c5754d52df326b` reproduced the microsecond cursor and resource-error-protocol bugs; both pass with PostgreSQL-backed evidence on `5d99bc73ecbb6e0937a4466181f3565869bc6aa0`. The suite does not claim that external provider behavior is covered; only the provider boundary is stubbed.
