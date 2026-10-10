export type McpEffectKind =
    | "read"
    | "write"
    | "destructive"
    | "external"
    | "costly_external"
    | "secret_write";

export interface IMcpToolEffect {
    kind: McpEffectKind;
    readOnly: boolean;
    destructive: boolean;
    idempotent: boolean;
    openWorld: boolean;
    minimumProfile: "read" | "eval" | "admin";
}

const READ_ONLY_TOOLS = new Set([
    "list_workspaces",
    "get_current_user",
    "list_eval_context",
    "list_projects",
    "get_dashboard",
    "list_datasets",
    "list_dataset_summaries_page",
    "get_dataset",
    "get_dataset_summary",
    "list_dataset_items",
    "get_prompt",
    "list_prompts",
    "list_runs",
    "list_run_summaries_page",
    "get_run",
    "get_run_progress",
    "get_run_summary",
    "list_run_cells",
    "list_workflows",
    "list_workflow_summaries_page",
    "get_workflow",
    "list_workflow_runs",
    "list_workflow_run_summaries_page",
    "get_workflow_run",
    "get_workflow_run_summary",
    "list_workflow_run_cells",
    "get_workflow_run_progress",
    "list_provider_keys",
    "list_workflow_llm_capabilities",
    "list_workflow_llm_routes",
    "list_workflow_llm_provider_models",
    "list_workflow_llm_route_history",
    "get_workflow_llm_default",
]);

const DESTRUCTIVE_TOOLS = new Set([
    "delete_dataset_item",
    "delete_dataset_label",
    "delete_dataset",
    "set_dataset_archived",
    "delete_prompt",
    "delete_run",
    "delete_workflow",
    "clear_provider_key",
    "clear_workflow_llm_default",
]);

const EXTERNAL_TOOLS = new Set([
    "generate_schema_from_prompt",
    "test_prompt_draft",
    "validate_runnable_prompt",
    "create_runnable_prompt",
    "optimize_prompt",
    "test_judge_draft",
    "generate_judge_for_run",
    "create_eval_run",
    "create_workflow_run",
    "retry_run",
    "create_stt_route_probe",
    "refresh_workflow_llm_capabilities",
    "list_workflow_llm_provider_models",
    "create_workflow_llm_route_version",
    "create_workflow_llm_route_for_model",
]);

const COSTLY_EXTERNAL_TOOLS = new Set([
    "generate_schema_from_prompt",
    "test_prompt_draft",
    "validate_runnable_prompt",
    "create_runnable_prompt",
    "optimize_prompt",
    "test_judge_draft",
    "generate_judge_for_run",
    "create_eval_run",
    "create_workflow_run",
    "retry_run",
    "create_stt_route_probe",
]);

const SECRET_WRITE_TOOLS = new Set(["set_provider_key"]);

const IDEMPOTENT_WRITES = new Set([
    "rename_workspace",
    "update_project",
    "update_dataset_item",
    "rename_dataset",
    "update_dataset_description",
    "set_dataset_archived",
    "delete_dataset_item",
    "delete_dataset_label",
    "delete_dataset",
    "delete_prompt",
    "save_run_note",
    "annotate_run_cell",
    "delete_run",
    "update_workflow",
    "delete_workflow",
    "save_workflow_run_note",
    "annotate_workflow_run_cell",
    "clear_provider_key",
    "disable_workflow_llm_route",
    "set_workflow_llm_default",
    "clear_workflow_llm_default",
]);

export function mcpToolEffect(name: string): IMcpToolEffect {
    const readOnly = READ_ONLY_TOOLS.has(name);
    const destructive = DESTRUCTIVE_TOOLS.has(name);
    const secretWrite = SECRET_WRITE_TOOLS.has(name);
    const costlyExternal = COSTLY_EXTERNAL_TOOLS.has(name);
    const external = EXTERNAL_TOOLS.has(name);
    return {
        kind: readOnly
            ? "read"
            : secretWrite
              ? "secret_write"
              : destructive
                ? "destructive"
                : costlyExternal
                  ? "costly_external"
                  : external
                    ? "external"
                    : "write",
        readOnly,
        destructive,
        idempotent: readOnly || IDEMPOTENT_WRITES.has(name),
        openWorld: external,
        minimumProfile: readOnly
            ? "read"
            : destructive || secretWrite
              ? "admin"
              : "eval",
    };
}

export type McpProfile = "read" | "eval" | "admin";

export function canMcpProfileCallTool(
    profile: McpProfile,
    effect: IMcpToolEffect,
): boolean {
    if (profile === "admin") return true;
    if (effect.minimumProfile === "read") return true;
    return profile === "eval" && effect.minimumProfile === "eval";
}

export function isKnownMcpToolEffect(name: string): boolean {
    return (
        READ_ONLY_TOOLS.has(name) ||
        DESTRUCTIVE_TOOLS.has(name) ||
        EXTERNAL_TOOLS.has(name) ||
        SECRET_WRITE_TOOLS.has(name) ||
        IDEMPOTENT_WRITES.has(name) ||
        ALL_WRITE_TOOLS.has(name)
    );
}

const ALL_WRITE_TOOLS = new Set([
    "create_workspace",
    "create_project",
    "create_dataset",
    "import_dataset_images",
    "import_dataset_text_items",
    "import_dataset_golden_answers",
    "preview_dataset_golden_answers",
    "commit_dataset_golden_answers",
    "import_dataset_image_answers",
    "import_dataset_paired_items",
    "add_dataset_item",
    "update_dataset_item",
    "rename_dataset",
    "update_dataset_description",
    "set_dataset_archived",
    "duplicate_dataset",
    "import_dataset_audio",
    "import_dataset_audio_answers",
    "delete_dataset_item",
    "delete_dataset_label",
    "delete_dataset",
    "create_runnable_prompt",
    "duplicate_prompt_version",
    "create_judge_prompt",
    "delete_prompt",
    "save_run_note",
    "annotate_run_cell",
    "retry_run",
    "delete_run",
    "create_workflow",
    "create_multiworkflow",
    "update_workflow",
    "delete_workflow",
    "select_workflow_llm_model",
    "save_workflow_run_note",
    "annotate_workflow_run_cell",
    "set_provider_key",
    "clear_provider_key",
    "create_workflow_llm_route_version",
    "create_workflow_llm_route_for_model",
    "disable_workflow_llm_route",
    "set_workflow_llm_default",
    "clear_workflow_llm_default",
]);
