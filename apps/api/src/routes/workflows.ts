import { randomUUID } from "node:crypto";
import type {
    ICreateWorkflowRequest,
    IPromptWorkflow,
    IUpdateWorkflowRequest,
    IWorkflowEdge,
    IWorkflowNode,
    IWorkflowSummary,
    ISttRunConfig,
    IWorkflowNodeInput,
    WorkflowKind,
    IWorkflowLlmRouteConfig,
} from "@mosaic/api-contract";
import { isWorkflowModelBackedNodeType } from "@mosaic/api-contract";
import { registryEntryFor } from "@mosaic/llm-core";
import type { IDb } from "../db.js";
import { withTransaction } from "../db.js";
import {
    ApiBadRequestError,
    ApiConflictError,
    ApiNotFoundError,
} from "../errors.js";
import { validateWorkflowLlmSelections } from "./llmRouting.js";
import { WorkflowLlmRouteConfig } from "./llmRoutingSchemas.js";
import { validateSttConfigDefinition } from "./runs/creation.js";

interface IWorkflowRow {
    id: string;
    teamId: string;
    projectId: string;
    name: string;
    description: string;
    sttConfig: ISttRunConfig | null;
    kind: WorkflowKind;
    createdAt: Date | string;
}

function iso(value: Date | string): string {
    return value instanceof Date ? value.toISOString() : value;
}

interface IWorkflowDagNode {
    nodeKey: string;
    label?: string;
    nodeType?: IWorkflowNodeInput["nodeType"];
    position?: unknown;
}

interface IWorkflowDagEdge {
    fromNodeKey: string;
    toNodeKey: string;
}

interface IWorkflowDagIndexes {
    inbound: Map<string, number>;
    outbound: Map<string, string[]>;
    adjacent: Map<string, string[]>;
}

function validateWorkflowNodePosition(position: unknown): void {
    if (position === undefined || position === null) return;
    if (
        typeof position !== "object" ||
        !("x" in position) ||
        !("y" in position) ||
        typeof position.x !== "number" ||
        typeof position.y !== "number" ||
        !Number.isFinite(position.x) ||
        !Number.isFinite(position.y)
    )
        throw new ApiBadRequestError(
            "Workflow node positions must contain finite numeric x and y coordinates.",
        );
}

function createWorkflowDagIndexes(keys: Set<string>): IWorkflowDagIndexes {
    return {
        inbound: new Map([...keys].map((key) => [key, 0])),
        outbound: new Map([...keys].map((key) => [key, [] as string[]])),
        adjacent: new Map([...keys].map((key) => [key, [] as string[]])),
    };
}

function indexWorkflowEdges(
    keys: Set<string>,
    edges: IWorkflowDagEdge[],
): IWorkflowDagIndexes {
    const indexes = createWorkflowDagIndexes(keys);
    const edgeKeys = new Set<string>();
    for (const edge of edges) {
        if (!keys.has(edge.fromNodeKey) || !keys.has(edge.toNodeKey))
            throw new ApiBadRequestError(
                "Every edge must reference an existing node.",
            );
        const edgeKey = `${edge.fromNodeKey}\u0000${edge.toNodeKey}`;
        if (edgeKeys.has(edgeKey))
            throw new ApiBadRequestError(
                "Duplicate directed workflow edges are not allowed.",
            );
        edgeKeys.add(edgeKey);
        indexes.inbound.set(
            edge.toNodeKey,
            (indexes.inbound.get(edge.toNodeKey) ?? 0) + 1,
        );
        indexes.outbound.get(edge.fromNodeKey)!.push(edge.toNodeKey);
        indexes.adjacent.get(edge.fromNodeKey)!.push(edge.toNodeKey);
        indexes.adjacent.get(edge.toNodeKey)!.push(edge.fromNodeKey);
    }
    return indexes;
}

function countTopologicallyVisitedNodes(
    roots: string[],
    inbound: Map<string, number>,
    outbound: Map<string, string[]>,
): number {
    const remaining = new Map(inbound);
    let ready = roots;
    let visited = 0;
    while (ready.length) {
        visited += ready.length;
        const next: string[] = [];
        for (const key of ready)
            for (const child of outbound.get(key) ?? []) {
                const count = (remaining.get(child) ?? 0) - 1;
                remaining.set(child, count);
                if (count === 0) next.push(child);
            }
        ready = next;
    }
    return visited;
}

function countWeaklyConnectedNodes(
    firstKey: string,
    adjacent: Map<string, string[]>,
): number {
    const connected = new Set<string>();
    const pending = [firstKey];
    while (pending.length) {
        const key = pending.pop()!;
        if (connected.has(key)) continue;
        connected.add(key);
        pending.push(...(adjacent.get(key) ?? []));
    }
    return connected.size;
}

export function validateWorkflowDag(
    nodes: IWorkflowDagNode[],
    edges: IWorkflowDagEdge[],
    kind: WorkflowKind = "prompt",
): void {
    if (!nodes.length)
        throw new ApiBadRequestError("Add at least one workflow node.");
    const keys = new Set(nodes.map((node) => node.nodeKey));
    if (keys.size !== nodes.length)
        throw new ApiBadRequestError("Every workflow node key must be unique.");
    for (const node of nodes) validateWorkflowNodePosition(node.position);
    const { inbound, outbound, adjacent } = indexWorkflowEdges(keys, edges);
    const roots = [...keys].filter((key) => inbound.get(key) === 0);
    const visited = countTopologicallyVisitedNodes(roots, inbound, outbound);
    if (roots.length === 0 || visited !== nodes.length)
        throw new ApiBadRequestError(
            kind === "prompt"
                ? "Workflow nodes must form one connected, acyclic graph."
                : "Workflow nodes must form an acyclic graph.",
        );
    if (kind === "prompt") {
        const connected = countWeaklyConnectedNodes([...keys][0]!, adjacent);
        if (connected !== nodes.length)
            throw new ApiBadRequestError(
                "Workflow nodes must form one connected, acyclic graph.",
            );
        return;
    }

    if (kind === "stt") {
        validateWorkflowRoots(nodes, roots, inbound, outbound, {
            nodeType: "stt",
            rootError: "Every STT workflow branch must begin with an STT node.",
            nodeLabel: "STT",
            ancestorLabel: "STT",
        });
        return;
    }

    validateWorkflowRoots(nodes, roots, inbound, outbound, {
        nodeType: "input",
        rootError: "Every multi workflow branch must begin with an input node.",
        nodeLabel: "Input",
        ancestorLabel: "input",
    });
}

interface IWorkflowRootValidation {
    nodeType: "stt" | "input";
    rootError: string;
    nodeLabel: "STT" | "Input";
    ancestorLabel: "STT" | "input";
}

function validateWorkflowRoots(
    nodes: IWorkflowDagNode[],
    roots: string[],
    inbound: Map<string, number>,
    outbound: Map<string, string[]>,
    validation: IWorkflowRootValidation,
): void {
    const nodeByKey = new Map(nodes.map((node) => [node.nodeKey, node]));
    const typedRoots = roots.filter(
        (key) =>
            (nodeByKey.get(key)?.nodeType ?? "prompt") === validation.nodeType,
    );
    if (typedRoots.length !== roots.length || typedRoots.length === 0)
        throw new ApiBadRequestError(validation.rootError);
    validateTypedNodesAreRoots(nodes, inbound, validation);
    const ancestors = propagateRootAncestors(typedRoots, inbound, outbound);
    validateSingleRootOwnership(
        nodes,
        typedRoots,
        ancestors,
        validation.ancestorLabel,
    );
}

function validateTypedNodesAreRoots(
    nodes: IWorkflowDagNode[],
    inbound: Map<string, number>,
    validation: IWorkflowRootValidation,
): void {
    const invalid = nodes.find(
        (node) =>
            node.nodeType === validation.nodeType &&
            (inbound.get(node.nodeKey) ?? 0) !== 0,
    );
    if (invalid)
        throw new ApiBadRequestError(
            `${validation.nodeLabel} node "${invalid.label ?? invalid.nodeKey}" must be a branch root.`,
        );
}

function propagateRootAncestors(
    roots: string[],
    inbound: Map<string, number>,
    outbound: Map<string, string[]>,
): Map<string, Set<string>> {
    const ancestors = new Map(roots.map((key) => [key, new Set([key])]));
    const remaining = new Map(inbound);
    let ready = roots;
    while (ready.length) {
        const next: string[] = [];
        for (const key of ready) {
            for (const child of outbound.get(key) ?? []) {
                const rootsForChild = ancestors.get(child) ?? new Set<string>();
                for (const root of ancestors.get(key) ?? [])
                    rootsForChild.add(root);
                ancestors.set(child, rootsForChild);
                const count = (remaining.get(child) ?? 0) - 1;
                remaining.set(child, count);
                if (count === 0) next.push(child);
            }
        }
        ready = next;
    }
    return ancestors;
}

function validateSingleRootOwnership(
    nodes: IWorkflowDagNode[],
    roots: string[],
    ancestors: Map<string, Set<string>>,
    ancestorLabel: "STT" | "input",
): void {
    const invalid = nodes.find(
        (node) =>
            !roots.includes(node.nodeKey) &&
            ancestors.get(node.nodeKey)?.size !== 1,
    );
    if (invalid)
        throw new ApiBadRequestError(
            `Node "${invalid.label ?? invalid.nodeKey}" must have exactly one ${ancestorLabel} root ancestor.`,
        );
}

function validateReasoningConfig(node: IWorkflowNodeInput): void {
    if (!node.reasoningConfig) return;
    const effort = node.reasoningConfig.effort;
    if (!["none", "minimal", "low", "medium", "high", "xhigh"].includes(effort))
        throw new ApiBadRequestError(
            `Node "${node.label}" has an invalid reasoning configuration.`,
        );
    if (!node.modelId) return;
    const supported = registryEntryFor(node.modelId)?.reasoningEffort;
    if (supported && !supported.supportedLevels.includes(effort))
        throw new ApiBadRequestError(
            `Node "${node.label}" does not support ${effort} reasoning effort.`,
        );
}

function validateNodeDefinition(node: IWorkflowNodeInput): void {
    const nodeType = node.nodeType ?? "prompt";
    const configType = node.nodeConfig?.type ?? "prompt";
    if (configType !== nodeType)
        throw new ApiBadRequestError(
            `Node "${node.label}" has a configuration for the wrong node type.`,
        );
    validateReasoningConfig(node);
    nodeDefinitionValidator(configType)(node);
    if (
        (nodeType === "llm_text" || nodeType === "judge") &&
        (!node.modelId ||
            (!registryEntryFor(node.modelId) &&
                node.llmExecutionSelection?.mode !== "simple"))
    )
        throw new ApiBadRequestError(
            `Node "${node.label}" must reference a registered model.`,
        );
}

function nodeDefinitionValidator(
    configType: string,
): (node: IWorkflowNodeInput) => void {
    const validators: Record<string, (node: IWorkflowNodeInput) => void> = {
        prompt: () => undefined,
        input: validateInputNodeDefinition,
        stt: validateSttNodeDefinition,
        llm_text: validateLlmTextNodeDefinition,
        transliterate: validateTransliterationNodeDefinition,
        judge: validateJudgeNodeDefinition,
        metric_compare: validateMetricNodeDefinition,
    };
    const validator = validators[configType];
    if (!validator)
        return (node) => {
            throw new ApiBadRequestError(
                `Node "${node.label}" has an unsupported node type.`,
            );
        };
    return validator;
}

const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validateInputNodeDefinition(node: IWorkflowNodeInput): void {
    if (node.nodeConfig?.type !== "input") return;
    // Loose comparison on purpose: the API serializes an absent model as JSON
    // null, so a node read back from the server and re-saved must not be
    // treated as if it referenced a model.
    if (node.modelId != null || node.promptVersionId != null)
        throw new ApiBadRequestError(
            `Input node "${node.label}" cannot reference a model or prompt version.`,
        );
    if (
        node.nodeConfig.modality !== "audio" &&
        node.nodeConfig.modality !== "image" &&
        node.nodeConfig.modality !== "text"
    )
        throw new ApiBadRequestError(
            `Node "${node.label}" has an invalid input modality.`,
        );
    if (
        node.nodeConfig.datasetId !== undefined &&
        !UUID_PATTERN.test(node.nodeConfig.datasetId)
    )
        throw new ApiBadRequestError(
            `Node "${node.label}" must reference a valid dataset ID.`,
        );
}

function validateSttNodeDefinition(node: IWorkflowNodeInput): void {
    if (node.nodeConfig?.type === "stt")
        validateSttConfigDefinition(node.nodeConfig.sttConfig);
}

function validateLlmTextNodeDefinition(node: IWorkflowNodeInput): void {
    if (
        node.nodeConfig?.type === "llm_text" &&
        !node.nodeConfig.promptText.trim()
    )
        throw new ApiBadRequestError(
            `Node "${node.label}" must include non-empty prompt text.`,
        );
}

function validateJudgeNodeDefinition(node: IWorkflowNodeInput): void {
    if (
        node.nodeConfig?.type === "judge" &&
        !node.nodeConfig.rubricPrompt.trim()
    )
        throw new ApiBadRequestError(
            `Node "${node.label}" must include a non-empty judge rubric.`,
        );
}

function validateTransliterationNodeDefinition(node: IWorkflowNodeInput): void {
    if (node.nodeConfig?.type !== "transliterate") return;
    const config = node.nodeConfig.transliteration;
    if (!config.enabled || config.targetScript !== "latin" || !config.modelId)
        throw new ApiBadRequestError(
            `Node "${node.label}" has an invalid transliteration configuration.`,
        );
    if (!registryEntryFor(config.modelId))
        throw new ApiBadRequestError(
            `Node "${node.label}" must reference a registered model.`,
        );
}

function validateMetricNodeDefinition(node: IWorkflowNodeInput): void {
    if (
        node.nodeConfig?.type === "metric_compare" &&
        !["expectedTranscript", "expectedTranscriptLatin"].includes(
            node.nodeConfig.referenceField,
        )
    )
        throw new ApiBadRequestError(
            `Node "${node.label}" has an invalid reference field.`,
        );
}

function validateNodeTypesForWorkflow(
    nodes: IWorkflowNodeInput[],
    kind: WorkflowKind,
): void {
    if (kind === "multi") {
        validateSharedInputDataset(nodes);
        return;
    }
    const invalid = nodes.find((node) =>
        kind === "prompt"
            ? (node.nodeType ?? "prompt") !== "prompt"
            : (node.nodeType ?? "prompt") === "prompt" ||
              node.nodeType === "input",
    );
    if (invalid)
        throw new ApiBadRequestError(
            `Node "${invalid.label}" is not valid in a ${kind} workflow.`,
        );
}

function validateWorkflowKind(kind: unknown): asserts kind is WorkflowKind {
    if (kind !== "prompt" && kind !== "stt" && kind !== "multi")
        throw new ApiBadRequestError(
            "Workflow kind must be prompt, stt, or multi.",
        );
}

function validateSharedInputDataset(nodes: IWorkflowNodeInput[]): void {
    const datasetIds = new Set(
        nodes.flatMap((node) =>
            node.nodeConfig?.type === "input" && node.nodeConfig.datasetId
                ? [node.nodeConfig.datasetId]
                : [],
        ),
    );
    if (datasetIds.size > 1)
        throw new ApiBadRequestError(
            "All input nodes in a workflow must reference the same dataset.",
        );
}

async function validateNodeReferences(
    db: IDb,
    input: Pick<ICreateWorkflowRequest, "teamId" | "projectId" | "nodes">,
): Promise<void> {
    for (const node of input.nodes) {
        validateNodeDefinition(node);
        if (node.evalConfig.type === "judge") {
            const sources = [
                node.evalConfig.judgeConfigId,
                node.evalConfig.judgePromptVersionId,
            ].filter(Boolean);
            if (sources.length !== 1) {
                throw new ApiBadRequestError(
                    "A judge evaluation must select exactly one judge source.",
                );
            }
        }
        if (
            node.evalConfig.type === "field_diff" &&
            node.evalConfig.fieldConfigs.length === 0
        ) {
            throw new ApiBadRequestError(
                "A field-difference evaluation must configure at least one field.",
            );
        }
    }
    const versionIds = [
        ...new Set(
            input.nodes.flatMap((node) =>
                (node.nodeType ?? "prompt") === "prompt"
                    ? [node.promptVersionId]
                    : [],
            ),
        ),
    ];
    const runnable = versionIds.length
        ? await db.query<{ id: string }>(
              `select pv.id from prompt_versions pv join prompts p on p.id = pv.prompt_id
         where pv.id = any($1::uuid[]) and pv.status = 'runnable' and p.team_id = $2 and p.project_id = $3`,
              [versionIds, input.teamId, input.projectId],
          )
        : { rows: [] };
    if (runnable.rows.length !== versionIds.length)
        throw new ApiNotFoundError(
            "Every node must reference a runnable prompt version in this project.",
        );

    const datasetIds = [
        ...new Set(
            input.nodes.flatMap((node) =>
                node.nodeConfig?.type === "input" && node.nodeConfig.datasetId
                    ? [node.nodeConfig.datasetId]
                    : [],
            ),
        ),
    ];
    if (datasetIds.length) {
        const datasets = await db.query<{ id: string }>(
            "select id from datasets where id = any($1::uuid[]) and team_id = $2 and project_id = $3",
            [datasetIds, input.teamId, input.projectId],
        );
        if (datasets.rows.length !== datasetIds.length)
            throw new ApiNotFoundError(
                "Every input node must reference a dataset in this project.",
            );
    }

    const judgeConfigIds = [
        ...new Set(
            input.nodes.flatMap((node) =>
                node.evalConfig.type === "judge" &&
                node.evalConfig.judgeConfigId
                    ? [node.evalConfig.judgeConfigId]
                    : [],
            ),
        ),
    ];
    if (judgeConfigIds.length) {
        const configs = await db.query<{ id: string }>(
            "select id from judge_configs where id = any($1::uuid[]) and team_id = $2 and project_id = $3",
            [judgeConfigIds, input.teamId, input.projectId],
        );
        if (configs.rows.length !== judgeConfigIds.length)
            throw new ApiNotFoundError(
                "Every judge config must belong to this project.",
            );
    }
    const judgePromptIds = [
        ...new Set(
            input.nodes.flatMap((node) =>
                node.evalConfig.type === "judge" &&
                node.evalConfig.judgePromptVersionId
                    ? [node.evalConfig.judgePromptVersionId]
                    : [],
            ),
        ),
    ];
    if (judgePromptIds.length) {
        const prompts = await db.query<{ id: string }>(
            `select pv.id from prompt_versions pv join prompts p on p.id = pv.prompt_id
             where pv.id = any($1::uuid[]) and pv.status = 'runnable' and p.team_id = $2 and p.project_id = $3`,
            [judgePromptIds, input.teamId, input.projectId],
        );
        if (prompts.rows.length !== judgePromptIds.length)
            throw new ApiNotFoundError(
                "Every judge prompt must be runnable and belong to this project.",
            );
    }
}

export async function replaceWorkflowGraph(
    db: IDb,
    workflowId: string,
    input: ICreateWorkflowRequest | IUpdateWorkflowRequest,
): Promise<void> {
    const nodeIds = new Map<string, string>();
    for (const node of input.nodes) {
        const nodeId = randomUUID();
        nodeIds.set(node.nodeKey, nodeId);
        await db.query(
            `insert into workflow_nodes(id, workflow_id, node_key, label, node_type, node_config, prompt_version_id, model_id, reasoning_config, llm_selection_mode, llm_transport, llm_route_version_id, eval_config, position)
             values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
            workflowNodeInsertValues(nodeId, workflowId, node),
        );
    }
    for (const edge of input.edges) {
        await db.query(
            `insert into workflow_edges(id, workflow_id, from_node_id, to_node_id, carry_original_input) values($1,$2,$3,$4,$5)`,
            [
                randomUUID(),
                workflowId,
                nodeIds.get(edge.fromNodeKey),
                nodeIds.get(edge.toNodeKey),
                edge.carryOriginalInput,
            ],
        );
    }
}

function workflowNodeInsertValues(
    nodeId: string,
    workflowId: string,
    node: IWorkflowNodeInput,
): unknown[] {
    return [
        nodeId,
        workflowId,
        node.nodeKey,
        node.label,
        node.nodeType ?? "prompt",
        node.nodeConfig ?? { type: "prompt" },
        node.promptVersionId ?? null,
        workflowNodeModelId(node),
        node.reasoningConfig ?? null,
        node.llmExecutionSelection?.mode ?? null,
        node.llmExecutionSelection?.mode === "simple"
            ? node.llmExecutionSelection.transport
            : null,
        node.llmExecutionSelection?.mode === "pinned_route"
            ? node.llmExecutionSelection.routeVersionId
            : null,
        node.evalConfig,
        node.position ?? null,
    ];
}

export function workflowNodeModelId(node: {
    nodeConfig?: IWorkflowNodeInput["nodeConfig"];
    modelId?: string;
}): string | null {
    if (node.nodeConfig?.type === "stt")
        return node.nodeConfig.sttConfig.modelId;
    if (node.nodeConfig?.type === "transliterate")
        return node.nodeConfig.transliteration.modelId;
    return node.modelId ?? null;
}

export async function listWorkflowsPayload(
    db: IDb,
    teamId: string,
    projectId: string,
    kind?: WorkflowKind,
): Promise<IWorkflowSummary[]> {
    const result = await db.query<IWorkflowRow & { nodeCount: number }>(
        `select w.id, w.team_id as "teamId", w.project_id as "projectId", w.name, w.description, w.kind,
                w.created_at as "createdAt", count(n.id)::int as "nodeCount"
         from prompt_workflows w left join workflow_nodes n on n.workflow_id = w.id
         where w.team_id = $1 and w.project_id = $2 and w.archived_at is null
           and ($3::text is null or w.kind = $3)
         group by w.id order by w.created_at desc`,
        [teamId, projectId, kind ?? null],
    );
    return result.rows.map((row) => ({
        ...row,
        kind: row.kind ?? "prompt",
        createdAt: iso(row.createdAt),
    }));
}

export async function listWorkflowSummariesPagePayload(
    db: IDb,
    teamId: string,
    projectId: string,
    input: {
        limit: number;
        kind?: WorkflowKind;
        cursor?: { createdAt: string; id: string };
    },
) {
    const result = await db.query<
        IWorkflowRow & { nodeCount: number; cursor_created_at: string }
    >(
        `select w.id,w.team_id as "teamId",w.project_id as "projectId",
                w.name,w.description,w.kind,w.created_at as "createdAt",
                count(n.id)::int as "nodeCount",
                to_char(w.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as cursor_created_at
         from prompt_workflows w
         left join workflow_nodes n on n.workflow_id=w.id
         where w.team_id=$1 and w.project_id=$2 and w.archived_at is null
           and ($3::text is null or w.kind=$3)
           and ($4::timestamptz is null or (w.created_at,w.id)<($4::timestamptz,$5::uuid))
         group by w.id
         order by w.created_at desc,w.id desc
         limit $6`,
        [
            teamId,
            projectId,
            input.kind ?? null,
            input.cursor?.createdAt ?? null,
            input.cursor?.id ?? null,
            input.limit + 1,
        ],
    );
    const complete = result.rows.length <= input.limit;
    const rows = result.rows.slice(0, input.limit);
    return {
        workflows: rows.map((row) => ({
            id: row.id,
            teamId: row.teamId,
            projectId: row.projectId,
            name: row.name,
            description: row.description,
            kind: row.kind ?? "prompt",
            createdAt: iso(row.createdAt),
            nodeCount: row.nodeCount,
        })),
        complete,
        ...(complete || rows.length === 0
            ? {}
            : {
                  nextCursor: {
                      createdAt: rows.at(-1)!.cursor_created_at,
                      id: rows.at(-1)!.id,
                  },
              }),
    };
}

export async function workflowDetailPayload(
    db: IDb,
    teamId: string,
    projectId: string,
    workflowId: string,
    lockForRun = false,
): Promise<IPromptWorkflow> {
    const workflow = (
        await db.query<IWorkflowRow>(
            `select id, team_id as "teamId", project_id as "projectId", name, description, kind, stt_config as "sttConfig", created_at as "createdAt" from prompt_workflows where id=$1 and team_id=$2 and project_id=$3 and archived_at is null${lockForRun ? " for share" : ""}`,
            [workflowId, teamId, projectId],
        )
    ).rows[0];
    if (!workflow) throw new ApiNotFoundError("Workflow not found.");
    const nodeRows = (
        await db.query<
            Omit<IWorkflowNode, "position"> & {
                position: IWorkflowNode["position"] | null;
            }
        >(
            `select id, workflow_id as "workflowId", node_key as "nodeKey", label, node_type as "nodeType", node_config as "nodeConfig", prompt_version_id as "promptVersionId", model_id as "modelId", reasoning_config as "reasoningConfig", llm_selection_mode as "llmSelectionMode", llm_transport as "llmTransport", llm_route_version_id as "llmRouteVersionId", eval_config as "evalConfig", position from workflow_nodes where workflow_id=$1 order by node_key${lockForRun ? " for share" : ""}`,
            [workflowId],
        )
    ).rows;
    const nodes = nodeRows.map(({ position, ...node }) => {
        const stored = node as typeof node & {
            llmSelectionMode?:
                "simple" | "pinned_route" | "project_default" | null;
            llmTransport?:
                "openai" | "gateway" | "openrouter" | "bifrost" | null;
            llmRouteVersionId?: string | null;
        };
        const {
            llmSelectionMode,
            llmTransport,
            llmRouteVersionId,
            ...nodeFields
        } = stored;
        const withSelection =
            llmSelectionMode === "simple" && llmTransport
                ? {
                      ...nodeFields,
                      llmExecutionSelection: {
                          mode: "simple" as const,
                          transport: llmTransport,
                      },
                  }
                : llmSelectionMode === "pinned_route" && llmRouteVersionId
                  ? {
                        ...nodeFields,
                        llmExecutionSelection: {
                            mode: "pinned_route" as const,
                            routeVersionId: llmRouteVersionId,
                        },
                    }
                  : llmSelectionMode === "project_default"
                    ? {
                          ...nodeFields,
                          llmExecutionSelection: {
                              mode: "project_default" as const,
                          },
                      }
                    : nodeFields;
        const shaped = stripFieldsTheNodeTypeForbids(withSelection);
        return position ? { ...shaped, position } : shaped;
    });
    const edges = (
        await db.query<IWorkflowEdge>(
            `select id, workflow_id as "workflowId", from_node_id as "fromNodeId", to_node_id as "toNodeId", carry_original_input as "carryOriginalInput" from workflow_edges where workflow_id=$1${lockForRun ? " for share" : ""}`,
            [workflowId],
        )
    ).rows;
    const { sttConfig, ...workflowFields } = workflow;
    return {
        ...workflowFields,
        kind: workflow.kind ?? "prompt",
        ...(sttConfig ? { sttConfig } : {}),
        createdAt: iso(workflow.createdAt),
        nodes,
        edges,
    };
}

// `model_id` and `prompt_version_id` are storage columns, not part of every
// node's logical shape: the CHECK constraints require a model on most rows, so
// an STT node's model is derived from its sttConfig and written to the column.
// Returning them where `IWorkflowNodeInput` declares them `undefined` makes the
// read disagree with the write, and a client that edits what it just read gets
// rejected for echoing a field the API handed it.
const NODE_TYPES_WITHOUT_MODEL = new Set(["input", "stt", "metric_compare"]);

// Absent optional columns come back as SQL NULL, and the contract types them as
// `undefined`. Emitting null makes a client that re-submits what it read fail
// validation on a field it never set, so absent means absent on the way out.
const NULLABLE_OPTIONAL_NODE_FIELDS = [
    "modelId",
    "promptVersionId",
    "reasoningConfig",
    "nodeConfig",
] as const;

function stripFieldsTheNodeTypeForbids<
    T extends {
        nodeType?: string;
        modelId?: unknown;
        promptVersionId?: unknown;
    },
>(node: T): T {
    const nodeType = node.nodeType ?? "prompt";
    const shaped: Record<string, unknown> = { ...node };
    if (NODE_TYPES_WITHOUT_MODEL.has(nodeType)) delete shaped.modelId;
    if (nodeType !== "prompt") delete shaped.promptVersionId;
    for (const field of NULLABLE_OPTIONAL_NODE_FIELDS)
        if (shaped[field] === null) delete shaped[field];
    return shaped as T;
}

export async function createWorkflowPayload(
    db: IDb,
    input: ICreateWorkflowRequest,
): Promise<IPromptWorkflow> {
    const kind = input.kind ?? "prompt";
    validateWorkflowKind(kind);
    validateNodeTypesForWorkflow(input.nodes, kind);
    validateWorkflowDag(input.nodes, input.edges, kind);
    if (input.sttConfig) validateSttConfigDefinition(input.sttConfig);
    await validateNodeReferences(db, input);
    await validateWorkflowLlmSelections(
        db,
        input.teamId,
        input.projectId,
        input.nodes,
    );
    const id = randomUUID();
    await withTransaction(db, async (tx) => {
        await tx.query(
            `insert into prompt_workflows(id,team_id,project_id,name,description,kind,stt_config,created_by) values($1,$2,$3,$4,$5,$6,$7,$8)`,
            [
                id,
                input.teamId,
                input.projectId,
                input.name.trim(),
                input.description ?? "",
                kind,
                input.sttConfig ?? null,
                input.createdBy,
            ],
        );
        await replaceWorkflowGraph(tx, id, input);
    });
    return workflowDetailPayload(db, input.teamId, input.projectId, id);
}

export async function updateWorkflowPayload(
    db: IDb,
    input: IUpdateWorkflowRequest,
): Promise<IPromptWorkflow> {
    return withTransaction(db, async (tx) => {
        const existing = await lockWorkflowForUpdate(tx, input);
        const kind = input.kind ?? existing.kind ?? "prompt";
        validateWorkflowKind(kind);
        validateNodeTypesForWorkflow(input.nodes, kind);
        validateWorkflowDag(input.nodes, input.edges, kind);
        if (input.sttConfig) validateSttConfigDefinition(input.sttConfig);
        await validateNodeReferences(tx, input);
        await validateWorkflowLlmSelections(
            tx,
            input.teamId,
            input.projectId,
            input.nodes,
        );
        const updatesSttConfig = Object.hasOwn(input, "sttConfig");
        const updated = await tx.query<{ id: string }>(
            `update prompt_workflows
             set name=$1,
                 description=$2,
                 stt_config=case when $3::boolean then $4::jsonb else stt_config end,
                 kind=$5
             where id=$6 and team_id=$7 and project_id=$8 and archived_at is null
             returning id`,
            [
                input.name.trim(),
                input.description ?? "",
                updatesSttConfig,
                input.sttConfig ?? null,
                kind,
                input.workflowId,
                input.teamId,
                input.projectId,
            ],
        );
        if (!updated.rows[0]) throw new ApiNotFoundError("Workflow not found.");
        await tx.query(`delete from workflow_edges where workflow_id=$1`, [
            input.workflowId,
        ]);
        await tx.query(`delete from workflow_nodes where workflow_id=$1`, [
            input.workflowId,
        ]);
        await replaceWorkflowGraph(tx, input.workflowId, input);
        return workflowDetailPayload(
            tx,
            input.teamId,
            input.projectId,
            input.workflowId,
        );
    });
}

interface IWorkflowEditScope {
    teamId: string;
    projectId: string;
    workflowId: string;
}

// All graph mutations lock the parent first, including full replacements. An
// archive's UPDATE takes the same row lock, and run snapshots use FOR SHARE.
// Read the graph only after acquiring this lock, never before waiting for it.
async function lockWorkflowForUpdate(
    db: IDb,
    input: IWorkflowEditScope,
): Promise<{ kind: WorkflowKind }> {
    const existing = (
        await db.query<{ kind: WorkflowKind }>(
            `select kind from prompt_workflows where id=$1 and team_id=$2 and project_id=$3 and archived_at is null for update`,
            [input.workflowId, input.teamId, input.projectId],
        )
    ).rows[0];
    if (!existing) throw new ApiNotFoundError("Workflow not found.");
    return existing;
}

export async function selectWorkflowLlmModelPayload(
    db: IDb,
    input: IWorkflowEditScope & { nodeKey: string; routeVersionId: string },
): Promise<IPromptWorkflow> {
    return withTransaction(db, async (tx) => {
        await lockWorkflowForUpdate(tx, input);
        const workflow = await workflowDetailPayload(
            tx,
            input.teamId,
            input.projectId,
            input.workflowId,
        );
        const node = workflow.nodes.find(
            (candidate) => candidate.nodeKey === input.nodeKey,
        );
        if (!node) {
            throw new ApiConflictError(
                `Workflow node ${input.nodeKey} no longer exists. Reload the workflow before selecting a model.`,
            );
        }
        if (!isWorkflowModelBackedNodeType(node.nodeType ?? "prompt")) {
            throw new ApiBadRequestError(
                `Workflow node ${input.nodeKey} does not support an LLM model selection.`,
            );
        }
        const routeVersion = (
            await tx.query<{ id: string; config: IWorkflowLlmRouteConfig }>(
                `select v.id, v.config
                 from llm_route_versions v
                 join llm_routes r
                   on r.id = v.route_id
                  and r.team_id = v.team_id
                  and r.project_id = v.project_id
                 where v.id = $1 and v.team_id = $2 and v.project_id = $3
                   and r.disabled_at is null`,
                [input.routeVersionId, input.teamId, input.projectId],
            )
        ).rows[0];
        if (!routeVersion) {
            throw new ApiBadRequestError(
                "The exact active route version was not found in this project.",
            );
        }
        const routeConfig = WorkflowLlmRouteConfig.parse(routeVersion.config);
        const nextNode = {
            ...node,
            modelId: routeConfig.modelId,
            reasoningConfig:
                routeConfig.generation.reasoningEffort !== undefined
                    ? { effort: routeConfig.generation.reasoningEffort }
                    : undefined,
            llmExecutionSelection: {
                mode: "pinned_route",
                routeVersionId: routeVersion.id,
            },
            ...(node.nodeConfig?.type === "transliterate"
                ? {
                      nodeConfig: {
                          ...node.nodeConfig,
                          transliteration: {
                              ...node.nodeConfig.transliteration,
                              modelId: routeConfig.modelId,
                          },
                      },
                  }
                : {}),
        } as IWorkflowNodeInput;
        // Reuse the same definition, reference and routing validation as graph
        // replacement, while leaving all unrelated nodes and edges untouched.
        await validateNodeReferences(tx, { ...input, nodes: [nextNode] });
        await validateWorkflowLlmSelections(tx, input.teamId, input.projectId, [
            nextNode,
        ]);
        const updated = await tx.query<{ id: string }>(
            `update workflow_nodes
             set model_id=$1, reasoning_config=$2, node_config=$3,
                 llm_selection_mode='pinned_route', llm_transport=null,
                 llm_route_version_id=$4
             where id=$5 and workflow_id=$6 and node_key=$7
             returning id`,
            [
                nextNode.modelId,
                nextNode.reasoningConfig ?? null,
                nextNode.nodeConfig ?? null,
                routeVersion.id,
                node.id,
                input.workflowId,
                input.nodeKey,
            ],
        );
        if (!updated.rows[0]) {
            throw new ApiConflictError(
                "The workflow node changed during model selection. Reload the workflow and retry.",
            );
        }
        return workflowDetailPayload(
            tx,
            input.teamId,
            input.projectId,
            input.workflowId,
        );
    });
}

export async function deleteWorkflowPayload(
    db: IDb,
    input: { teamId: string; projectId: string; workflowId: string },
): Promise<void> {
    await db.query(
        `update prompt_workflows set archived_at = now()
         where id=$1 and team_id=$2 and project_id=$3 and archived_at is null`,
        [input.workflowId, input.teamId, input.projectId],
    );
}

export {
    createWorkflowRunPayload,
    listWorkflowRunCellsPagePayload,
    listWorkflowRunSummariesPagePayload,
    listWorkflowRunsPayload,
    saveWorkflowRunCellAnnotationPayload,
    saveWorkflowRunNotePayload,
    workflowRunDetailPayload,
    workflowRunProgressPayload,
    workflowRunSummaryPayload,
} from "./workflowRuns.js";
