import type {
    IRunDataPolicy,
    IWorkflowRunConfig,
} from "@flash-evals/api-contract";
import { Num } from "@/components/ui/num";
import { fmtCost } from "@/lib/format";

/** "Only vertex, bedrock · zero data retention · no training on prompts". */
export function describeDataRules(policy: IRunDataPolicy): string {
    return [
        policy.onlyHosts?.length
            ? `Only ${policy.onlyHosts.join(", ")}`
            : undefined,
        policy.zeroDataRetention ? "zero data retention" : undefined,
        policy.disallowPromptTraining ? "no training on prompts" : undefined,
    ]
        .filter(Boolean)
        .join(" · ");
}

/**
 * The spend limit and data rules a pipeline run was started with. Nothing
 * renders for a run started without either.
 */
export function WorkflowRunSettings({
    config,
}: {
    config: IWorkflowRunConfig | undefined;
}) {
    const rules = config?.dataPolicy
        ? describeDataRules(config.dataPolicy)
        : "";
    if (config?.maxCostUsd === undefined && !rules) return null;
    return (
        <dl
            aria-label="Run settings"
            className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2"
        >
            {config?.maxCostUsd !== undefined && (
                <div className="flex min-w-0 flex-col gap-1">
                    <dt className="text-label-12 text-muted-foreground">
                        Spend limit
                    </dt>
                    <dd className="text-copy-14">
                        <Num>{fmtCost(config.maxCostUsd)}</Num>
                    </dd>
                </div>
            )}
            {rules && (
                <div className="flex min-w-0 flex-col gap-1">
                    <dt className="text-label-12 text-muted-foreground">
                        Data rules
                    </dt>
                    <dd className="text-copy-14 break-words">{rules}</dd>
                </div>
            )}
        </dl>
    );
}
