"use client";

import { useActionState, useEffect, useState } from "react";
import type {
    IPromptWorkflow,
    IRunSetupDatasetOption,
} from "@mosaic/api-contract";
import { isWorkflowModelBackedNodeType } from "@mosaic/api-contract";
import type { IActionState } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    requestWorkflowNodeRepair,
    workflowNodeKeyFromErrorPath,
} from "./workflow-node-repair";
import { Hint } from "@/components/ui/hint";

// eslint-disable-next-line complexity -- launch validation maps multiple user-facing error states.
export function SttRunLaunch({
    workflow,
    datasets,
    initialDatasetId,
    action,
    disabled,
}: {
    workflow: IPromptWorkflow;
    datasets: IRunSetupDatasetOption[];
    initialDatasetId?: string;
    action: (state: IActionState, data: FormData) => Promise<IActionState>;
    disabled?: boolean;
}) {
    const inputConfigs = workflow.nodes.flatMap((node) =>
        node.nodeConfig?.type === "input" ? [node.nodeConfig] : [],
    );
    const inputDatasetIds = new Set(
        inputConfigs.flatMap((config) =>
            config.datasetId ? [config.datasetId] : [],
        ),
    );
    const inputModalities = new Set(
        inputConfigs.map((config) => config.modality),
    );
    const isMulti = workflow.kind === "multi";
    const unresolvedNodes = workflow.nodes.filter((node) =>
        isWorkflowModelBackedNodeType(node.nodeType ?? "prompt")
            ? !node.llmExecutionSelection
            : false,
    );
    const configurationError =
        isMulti && inputConfigs.length === 0
            ? "Add an input block and bind a dataset before running."
            : isMulti && inputDatasetIds.size !== 1
              ? "All input blocks must bind the same dataset before running."
              : isMulti && inputModalities.size !== 1
                ? "All input blocks must use the same modality before running."
                : undefined;
    const inputDatasetId = [...inputDatasetIds][0];
    const inputModality = [...inputModalities][0];
    const eligibleDatasets = isMulti
        ? datasets.filter(
              (dataset) =>
                  dataset.id === inputDatasetId &&
                  dataset.modality === inputModality,
          )
        : datasets.filter((dataset) => dataset.modality === "audio");
    const [datasetId, setDatasetId] = useState(
        isMulti
            ? (eligibleDatasets[0]?.id ?? "")
            : eligibleDatasets.some(
                    (dataset) => dataset.id === initialDatasetId,
                )
              ? initialDatasetId!
              : (eligibleDatasets[0]?.id ?? ""),
    );
    const [state, formAction, pending] = useActionState(action, {});
    const [idempotencyKey] = useState(() => crypto.randomUUID());
    useEffect(() => {
        const path = Object.keys(state.fieldErrors ?? {}).find((key) =>
            key.endsWith(".llmExecutionSelection"),
        );
        const nodeKey = path ? workflowNodeKeyFromErrorPath(path) : undefined;
        if (nodeKey) requestWorkflowNodeRepair(nodeKey);
    }, [state.fieldErrors]);
    return (
        <Card>
            <CardHeader>
                <CardTitle as="h2">Run flow</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
                <form action={formAction} className="flex flex-col gap-3">
                    <input
                        type="hidden"
                        name="workflowId"
                        value={workflow.id}
                    />
                    <input type="hidden" name="datasetId" value={datasetId} />
                    <input type="hidden" name="runTarget" value="dataset" />
                    <input
                        type="hidden"
                        name="idempotencyKey"
                        value={idempotencyKey}
                    />
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                        <div className="flex min-w-64 flex-1 flex-col gap-2">
                            <Label htmlFor="run-dataset">
                                {isMulti
                                    ? `${inputModality ? `${inputModality[0]?.toUpperCase()}${inputModality.slice(1)}` : "Input"} dataset`
                                    : "Audio dataset"}
                            </Label>
                            <Select
                                value={datasetId}
                                onValueChange={setDatasetId}
                                disabled={isMulti}
                            >
                                <SelectTrigger
                                    id="run-dataset"
                                    aria-describedby={
                                        configurationError
                                            ? "run-launch-config-error"
                                            : undefined
                                    }
                                >
                                    <SelectValue placeholder="Select dataset" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectGroup>
                                        {eligibleDatasets.map((dataset) => (
                                            <SelectItem
                                                key={dataset.id}
                                                value={dataset.id}
                                                disabled={!dataset.itemCount}
                                            >
                                                {dataset.name} (
                                                {dataset.itemCount})
                                            </SelectItem>
                                        ))}
                                    </SelectGroup>
                                </SelectContent>
                            </Select>
                        </div>
                        <Button
                            type="submit"
                            loading={pending}
                            loadingText="Starting…"
                            aria-describedby={
                                [
                                    state.formError && "run-launch-form-error",
                                    configurationError &&
                                        "run-launch-config-error",
                                ]
                                    .filter(Boolean)
                                    .join(" ") || undefined
                            }
                            disabled={
                                disabled ||
                                !datasetId ||
                                Boolean(configurationError) ||
                                unresolvedNodes.length > 0
                            }
                        >
                            {disabled ? "Save before running" : "Run flow"}
                        </Button>
                    </div>
                    {state.formError ? (
                        <p
                            id="run-launch-form-error"
                            role="alert"
                            className="text-copy-14 text-error"
                        >
                            {state.formError}
                        </p>
                    ) : null}
                    {configurationError ? (
                        <p
                            id="run-launch-config-error"
                            role="alert"
                            className="text-copy-14 text-error"
                        >
                            {configurationError}
                        </p>
                    ) : null}
                </form>
                {unresolvedNodes.length > 0 ? (
                    // Flat: a divider row inside the card, not a box.
                    <div
                        role="alert"
                        className="flex flex-col gap-2 border-t border-border pt-3"
                    >
                        <p className="text-copy-14 text-error">
                            Repair every model-backed node before launch. Choose
                            the project default or pin an immutable route.
                        </p>
                        <div className="flex flex-wrap gap-2">
                            {unresolvedNodes.map((node) => (
                                // Long labels truncate so the button can't
                                // push the page wider than a phone.
                                <Hint key={node.nodeKey} content={node.label}>
                                    <Button
                                        type="button"
                                        variant="secondary"
                                        size="sm"
                                        className="max-w-full"
                                        onClick={() =>
                                            requestWorkflowNodeRepair(
                                                node.nodeKey,
                                            )
                                        }
                                    >
                                        <span className="truncate">
                                            Repair {node.label}
                                        </span>
                                    </Button>
                                </Hint>
                            ))}
                        </div>
                    </div>
                ) : null}
            </CardContent>
        </Card>
    );
}
