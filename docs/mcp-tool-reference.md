# MCP tool reference

[MCP guide](mcp-eval-server.md) · [Documentation home](../README.md#documentation)

The server exposes 84 tools. This page is a navigation index; call `tools/list`
for the exact argument schemas and annotations on your running revision. The
[MCP guide](mcp-eval-server.md#a-first-evaluation-through-tools) shows a complete
small evaluation, including IDs, validation, and result handling.

### Identity, workspaces, and projects (9)

Discover the authenticated account and choose a workspace/project before calling project-scoped tools. `list_eval_context` supplies the datasets, runnable prompts, models, and routing context for that selection.

- `list_workspaces`
- `create_workspace`
- `rename_workspace`
- `get_current_user`
- `list_eval_context`
- `list_projects`
- `create_project`
- `update_project`
- `get_dashboard`

### Datasets (23)

Use `golden` datasets for reference answers and `evaluation` datasets for inputs without required references. For answer imports, preview mappings and diagnostics before committing. Image and audio upload tools accept base64-encoded files.

- `list_datasets`
- `get_dataset`
- `get_dataset_summary`
- `list_dataset_items`
- `create_dataset`
- `import_dataset_images`
- `import_dataset_text_items`
- `import_dataset_golden_answers`
- `preview_dataset_golden_answers`
- `commit_dataset_golden_answers`
- `import_dataset_image_answers`
- `import_dataset_paired_items`
- `add_dataset_item`
- `update_dataset_item`
- `delete_dataset_item`
- `delete_dataset_label`
- `rename_dataset`
- `update_dataset_description`
- `set_dataset_archived`
- `duplicate_dataset`
- `delete_dataset`
- `import_dataset_audio`
- `import_dataset_audio_answers`

### Prompts (12)

`create_runnable_prompt` validates its samples and saves on success in one call. Use `test_prompt_draft` or `validate_runnable_prompt` separately for exploratory checks; creating a version validates again. Judge prompts grade outputs against a rubric.

- `list_prompts`
- `get_prompt`
- `generate_schema_from_prompt`
- `test_prompt_draft`
- `validate_runnable_prompt`
- `create_runnable_prompt`
- `optimize_prompt`
- `test_judge_draft`
- `generate_judge_for_run`
- `create_judge_prompt`
- `duplicate_prompt_version`
- `delete_prompt`

### Runs and review (10)

Keep the run ID returned by creation, poll progress, and inspect individual cells before relying on aggregate scores. Notes describe a whole run; annotations attach a review verdict or comment to a cell.

- `list_runs`
- `get_run`
- `get_run_summary`
- `list_run_cells`
- `get_run_progress`
- `create_eval_run`
- `save_run_note`
- `annotate_run_cell`
- `retry_run`
- `delete_run`

### Provider settings and model routing (15)

Provider-key listing reports configuration status without returning secret values. Use transport-specific model discovery to choose a model, then create a saved route and optionally make it the project default. Capability refreshes and STT probes contact providers; inspect the tool description before calling them.

- `list_provider_keys`
- `set_provider_key`
- `clear_provider_key`
- `create_stt_route_probe`
- `list_workflow_llm_capabilities`
- `refresh_workflow_llm_capabilities`
- `list_workflow_llm_routes`
- `list_workflow_llm_provider_models`
- `list_workflow_llm_route_history`
- `create_workflow_llm_route_version`
- `create_workflow_llm_route_for_model`
- `disable_workflow_llm_route`
- `get_workflow_llm_default`
- `set_workflow_llm_default`
- `clear_workflow_llm_default`

### Workflows (15)

Read the saved graph before editing it. `update_workflow` replaces the graph; `select_workflow_llm_model` selects the route for one model-backed node. Workflow-run creation requires a stable idempotency key so the same request can be retried without creating another run.

- `list_workflows`
- `get_workflow`
- `create_workflow`
- `create_multiworkflow`
- `update_workflow`
- `delete_workflow`
- `select_workflow_llm_model`
- `create_workflow_run`
- `list_workflow_runs`
- `get_workflow_run`
- `get_workflow_run_summary`
- `list_workflow_run_cells`
- `save_workflow_run_note`
- `annotate_workflow_run_cell`
- `get_workflow_run_progress`
