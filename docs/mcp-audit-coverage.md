# MCP audit coverage

## Catalog under test

The MCP server reports `mosaic-evals` version `0.1.0`. The complete current catalog contains 88 tools, 8 resource templates, and the `create_eval_happy_path` prompt. The original catalog had 78 tools; ten additional tools provide bounded summary and page readers for dataset items, datasets, eval runs, workflow runs, and workflow summaries. The full tool names, descriptions, input schemas, and effect annotations are snapshotted in `apps/api/src/mcp/__snapshots__/registry.test.ts.snap`.

The transport matrix in `apps/api/src/mcp/toolCoverage.test.ts` registers every tool through the production registry and calls it through the MCP SDK's actual stdio and streamable HTTP transports. Domain payloads and paid-provider boundaries are mocked in this broad matrix so destructive calls only touch synthetic fixtures and provider calls never incur charges. It verifies a successful handler result for all 88 tools; malformed arguments are rejected for every tool with an input schema. The three no-input-schema tools (`list_workspaces`, `get_current_user`, `list_provider_keys`) have no meaningful schema-invalid case.

That matrix verifies transport, registration, input decoding, output-schema validation, and profile guards. It does not substitute for business-logic or persistence coverage. Those paths are separately tested against real Postgres or at route level, below.

## Per-tool matrix

`HTTP+stdio` means each tool is called through both MCP transports using synthetic route fixtures. `Invalid` means each tool with an input schema also receives a schema-invalid call over both transports. `Read allowed` and `Read denied` record the read-profile direct-call result; the profile test calls every tool name from the full admin catalog even when the tool is hidden from `tools/list`.

| Tool                                  | Positive call | Invalid input   | Read profile |
| ------------------------------------- | ------------- | --------------- | ------------ |
| `list_workspaces`                     | HTTP+stdio    | No input schema | Read allowed |
| `create_workspace`                    | HTTP+stdio    | Invalid         | Read denied  |
| `rename_workspace`                    | HTTP+stdio    | Invalid         | Read denied  |
| `get_current_user`                    | HTTP+stdio    | No input schema | Read allowed |
| `list_eval_context`                   | HTTP+stdio    | Invalid         | Read allowed |
| `list_projects`                       | HTTP+stdio    | Invalid         | Read allowed |
| `create_project`                      | HTTP+stdio    | Invalid         | Read denied  |
| `update_project`                      | HTTP+stdio    | Invalid         | Read denied  |
| `get_dashboard`                       | HTTP+stdio    | Invalid         | Read allowed |
| `list_datasets`                       | HTTP+stdio    | Invalid         | Read allowed |
| `get_dataset`                         | HTTP+stdio    | Invalid         | Read allowed |
| `get_dataset_summary`                 | HTTP+stdio    | Invalid         | Read allowed |
| `list_dataset_items`                  | HTTP+stdio    | Invalid         | Read allowed |
| `list_dataset_summaries_page`         | HTTP+stdio    | Invalid         | Read allowed |
| `create_dataset`                      | HTTP+stdio    | Invalid         | Read denied  |
| `import_dataset_images`               | HTTP+stdio    | Invalid         | Read denied  |
| `import_dataset_text_items`           | HTTP+stdio    | Invalid         | Read denied  |
| `import_dataset_golden_answers`       | HTTP+stdio    | Invalid         | Read denied  |
| `preview_dataset_golden_answers`      | HTTP+stdio    | Invalid         | Read denied  |
| `commit_dataset_golden_answers`       | HTTP+stdio    | Invalid         | Read denied  |
| `import_dataset_image_answers`        | HTTP+stdio    | Invalid         | Read denied  |
| `import_dataset_paired_items`         | HTTP+stdio    | Invalid         | Read denied  |
| `add_dataset_item`                    | HTTP+stdio    | Invalid         | Read denied  |
| `update_dataset_item`                 | HTTP+stdio    | Invalid         | Read denied  |
| `delete_dataset_item`                 | HTTP+stdio    | Invalid         | Read denied  |
| `delete_dataset_label`                | HTTP+stdio    | Invalid         | Read denied  |
| `rename_dataset`                      | HTTP+stdio    | Invalid         | Read denied  |
| `update_dataset_description`          | HTTP+stdio    | Invalid         | Read denied  |
| `set_dataset_archived`                | HTTP+stdio    | Invalid         | Read denied  |
| `duplicate_dataset`                   | HTTP+stdio    | Invalid         | Read denied  |
| `delete_dataset`                      | HTTP+stdio    | Invalid         | Read denied  |
| `import_dataset_audio`                | HTTP+stdio    | Invalid         | Read denied  |
| `import_dataset_audio_answers`        | HTTP+stdio    | Invalid         | Read denied  |
| `list_prompts`                        | HTTP+stdio    | Invalid         | Read allowed |
| `get_prompt`                          | HTTP+stdio    | Invalid         | Read allowed |
| `generate_schema_from_prompt`         | HTTP+stdio    | Invalid         | Read denied  |
| `test_prompt_draft`                   | HTTP+stdio    | Invalid         | Read denied  |
| `validate_runnable_prompt`            | HTTP+stdio    | Invalid         | Read denied  |
| `create_runnable_prompt`              | HTTP+stdio    | Invalid         | Read denied  |
| `optimize_prompt`                     | HTTP+stdio    | Invalid         | Read denied  |
| `test_judge_draft`                    | HTTP+stdio    | Invalid         | Read denied  |
| `generate_judge_for_run`              | HTTP+stdio    | Invalid         | Read denied  |
| `create_judge_prompt`                 | HTTP+stdio    | Invalid         | Read denied  |
| `duplicate_prompt_version`            | HTTP+stdio    | Invalid         | Read denied  |
| `delete_prompt`                       | HTTP+stdio    | Invalid         | Read denied  |
| `list_runs`                           | HTTP+stdio    | Invalid         | Read allowed |
| `get_run`                             | HTTP+stdio    | Invalid         | Read allowed |
| `get_run_progress`                    | HTTP+stdio    | Invalid         | Read allowed |
| `get_run_summary`                     | HTTP+stdio    | Invalid         | Read allowed |
| `list_run_cells`                      | HTTP+stdio    | Invalid         | Read allowed |
| `list_run_summaries_page`             | HTTP+stdio    | Invalid         | Read allowed |
| `create_eval_run`                     | HTTP+stdio    | Invalid         | Read denied  |
| `save_run_note`                       | HTTP+stdio    | Invalid         | Read denied  |
| `annotate_run_cell`                   | HTTP+stdio    | Invalid         | Read denied  |
| `retry_run`                           | HTTP+stdio    | Invalid         | Read denied  |
| `delete_run`                          | HTTP+stdio    | Invalid         | Read denied  |
| `list_provider_keys`                  | HTTP+stdio    | No input schema | Read allowed |
| `set_provider_key`                    | HTTP+stdio    | Invalid         | Read denied  |
| `clear_provider_key`                  | HTTP+stdio    | Invalid         | Read denied  |
| `create_stt_route_probe`              | HTTP+stdio    | Invalid         | Read denied  |
| `list_workflow_llm_capabilities`      | HTTP+stdio    | Invalid         | Read allowed |
| `refresh_workflow_llm_capabilities`   | HTTP+stdio    | Invalid         | Read denied  |
| `list_workflow_llm_routes`            | HTTP+stdio    | Invalid         | Read allowed |
| `list_workflow_llm_provider_models`   | HTTP+stdio    | Invalid         | Read allowed |
| `list_workflow_llm_route_history`     | HTTP+stdio    | Invalid         | Read allowed |
| `create_workflow_llm_route_version`   | HTTP+stdio    | Invalid         | Read denied  |
| `create_workflow_llm_route_for_model` | HTTP+stdio    | Invalid         | Read denied  |
| `disable_workflow_llm_route`          | HTTP+stdio    | Invalid         | Read denied  |
| `get_workflow_llm_default`            | HTTP+stdio    | Invalid         | Read allowed |
| `set_workflow_llm_default`            | HTTP+stdio    | Invalid         | Read denied  |
| `clear_workflow_llm_default`          | HTTP+stdio    | Invalid         | Read denied  |
| `list_workflows`                      | HTTP+stdio    | Invalid         | Read allowed |
| `get_workflow`                        | HTTP+stdio    | Invalid         | Read allowed |
| `create_workflow`                     | HTTP+stdio    | Invalid         | Read denied  |
| `create_multiworkflow`                | HTTP+stdio    | Invalid         | Read denied  |
| `update_workflow`                     | HTTP+stdio    | Invalid         | Read denied  |
| `delete_workflow`                     | HTTP+stdio    | Invalid         | Read denied  |
| `select_workflow_llm_model`           | HTTP+stdio    | Invalid         | Read denied  |
| `create_workflow_run`                 | HTTP+stdio    | Invalid         | Read denied  |
| `list_workflow_runs`                  | HTTP+stdio    | Invalid         | Read allowed |
| `list_workflow_run_summaries_page`    | HTTP+stdio    | Invalid         | Read allowed |
| `list_workflow_summaries_page`        | HTTP+stdio    | Invalid         | Read allowed |
| `get_workflow_run`                    | HTTP+stdio    | Invalid         | Read allowed |
| `get_workflow_run_summary`            | HTTP+stdio    | Invalid         | Read allowed |
| `list_workflow_run_cells`             | HTTP+stdio    | Invalid         | Read allowed |
| `save_workflow_run_note`              | HTTP+stdio    | Invalid         | Read denied  |
| `annotate_workflow_run_cell`          | HTTP+stdio    | Invalid         | Read denied  |
| `get_workflow_run_progress`           | HTTP+stdio    | Invalid         | Read allowed |

## Resources and prompt

| Surface                  | HTTP         | stdio        | Evidence                                   |
| ------------------------ | ------------ | ------------ | ------------------------------------------ |
| `mosaic-dataset`         | Read success | Read success | Complete legacy detail resource            |
| `mosaic-prompt`          | Read success | Read success | Complete prompt detail resource            |
| `mosaic-run`             | Read success | Read success | Complete legacy run matrix resource        |
| `mosaic-models`          | Read success | Read success | Project model options resource             |
| `mosaic-dataset-summary` | Read success | Read success | Compact summary with bounded-page link     |
| `mosaic-dataset-items`   | Read success | Read success | Bounded first page and completion metadata |
| `mosaic-run-summary`     | Read success | Read success | Compact summary with bounded-page link     |
| `mosaic-run-cells`       | Read success | Read success | Bounded first page and completion metadata |
| `create_eval_happy_path` | Get success  | Get success  | Prompt content returned by both transports |

Read-profile calls now positively exercise every independently listed read tool through both HTTP and stdio, alongside direct denials for every restricted tool. Eval-profile coverage checks a successful read and write plus an admin-only denial over both transports. Read-profile resource access is also exercised through stdio. Resource handlers use the authenticated project resolver; HTTP and stdio tests cover cross-tenant reads, protocol errors, and team/project ownership.

Successful tools retain the complete compact JSON text fallback alongside `structuredContent.data`, including for results larger than 24,000 characters, to preserve v1 text-only client behavior. This duplicates large result payloads; bounded page tools are the recommended path for large datasets and matrices. `create_runnable_prompt` declares a discriminated `saved` / `validation_failed` / `provider_error` output; persistence failures remain MCP tool errors.

## Persistence and route evidence

| Concern                                                   | Test evidence                                                                                            | Boundary                                                                                                                                                                                                                |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dataset/run/workflow summary and stable keyset pages      | `apps/api/src/routes/mcpReaders.integration.test.ts`                                                     | Real disposable Postgres with 129 dataset items (including microsecond cursor rows), 258 run cells, 129 workflow cells, and 125 rows per summary list; asserts stable traversal, filters, summaries, and opt-in details |
| Duplicate IDs, concurrency, and lost-response replay      | `apps/api/src/mcp/idempotency.integration.test.ts`                                                       | Real disposable Postgres; synthetic dataset/prompt fixtures; concurrent requests and same-key replay create one copy                                                                                                    |
| Input constraints, profile effects, and handler semantics | `apps/api/src/mcp/tools/*.test.ts`, `apps/api/src/mcp/registry.test.ts`, `apps/api/src/mcp/auth.test.ts` | Route payloads mocked in MCP unit tests; provider-payload tests mock paid boundaries                                                                                                                                    |
| HTTP auth, compatibility, errors, and protocol            | `apps/api/src/mcp/http.test.ts`, plus the HTTP matrix above                                              | Real streamable HTTP transport; OAuth resolution is stubbed only in the exhaustive fixture matrix                                                                                                                       |
| stdio registration and protocol                           | `apps/api/src/mcp/stdio.test.ts`, plus the stdio matrix above                                            | Real MCP `StdioServerTransport` and SDK client connected through in-memory byte streams                                                                                                                                 |

The full workspace suite previously passed on the combined implementation and acceptance-test head (`pnpm test`: 174 files passed, 3 skipped; 1,273 passed, 5 skipped). The API Postgres integrations are opt-in and were skipped in that checkout because no `MOSAIC_TEST_DATABASE_URL` was configured. The separate [real-backend acceptance ledger](mcp-real-backend-acceptance.md) records the 10/10 HTTP/Postgres scenarios, reader/idempotency integration results, and the exact distinction between HTTP/Postgres and stdio profile coverage. The final text-fallback compatibility regression has a dedicated >24,000-character test.

## Catalog-size note

No schema-factoring or catalog-size reduction is claimed here. The create/update workflow graph schemas remain domain-specific and preserve the useful workflow primitives. The catalog snapshot and both SDK transport matrices validate that client-visible schemas are emitted and accepted; a separate measured client-compatibility experiment would be needed before making an optimization claim.

## Remaining compatibility and follow-up notes

- The legacy `list_datasets`, `list_runs`, `list_workflows`, and `list_workflow_runs` responses return all matching summaries; `get_dataset`, `get_run`, and `get_workflow_run` remain complete for v1 compatibility. These results are not silently truncated. The corresponding bounded summary/item/cell readers are recommended for large collections, and tool descriptions identify the legacy behavior.
- Workflow-run creation requires a stable idempotency key before the first request; ordinary eval-run creation retains its existing optional key contract.
- Run progress tools return current status and aggregate counts; regular eval-run creation also returns `enqueueStatus`. They do not yet publish a recommended polling interval, so clients should continue polling the progress tool until its status is terminal.
- The exhaustive transport matrix uses deterministic route and provider fixtures. The independent Postgres acceptance ledger records real database-backed scenarios separately; true provider-socket lost-response recovery is intentionally not exercised because it would require a live external provider boundary.
- Catalog optimization remains unmeasured; no schema factoring or client-compatibility claim is made.
