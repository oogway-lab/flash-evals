import type {
    IRunDataPolicy,
    ProviderTransport,
} from "@flash-evals/api-contract";
import { hasDataPolicy } from "@flash-evals/llm-core";
import { sql, type SQL, type SQLWrapper } from "drizzle-orm";

/**
 * Data rules in one comparable shape: hosts as a sorted set, flags as
 * booleans. A missing flag or host list means the same as false or empty.
 */
export interface INormalizedDataPolicy {
    onlyHosts: string[];
    zeroDataRetention: boolean;
    disallowPromptTraining: boolean;
}

/** The rules in comparable form; undefined when they set no rule. */
export function normalizedDataPolicy(
    policy: IRunDataPolicy | undefined,
): INormalizedDataPolicy | undefined {
    if (!policy || !hasDataPolicy(policy)) return undefined;
    return {
        onlyHosts: [...new Set(policy.onlyHosts ?? [])].sort(),
        zeroDataRetention: policy.zeroDataRetention === true,
        disallowPromptTraining: policy.disallowPromptTraining === true,
    };
}

/** True when both set the same rules (hosts compared as a set). */
export function sameDataPolicy(
    a: IRunDataPolicy | undefined,
    b: IRunDataPolicy | undefined,
): boolean {
    const left = normalizedDataPolicy(a);
    const right = normalizedDataPolicy(b);
    if (!left || !right) return left === right;
    return (
        left.zeroDataRetention === right.zeroDataRetention &&
        left.disallowPromptTraining === right.disallowPromptTraining &&
        left.onlyHosts.length === right.onlyHosts.length &&
        left.onlyHosts.every((host, index) => host === right.onlyHosts[index])
    );
}

/**
 * A SQL condition: the run whose `config_snapshot` is given ran under exactly
 * these rules. Hosts are compared as sets (containment both ways ignores order
 * and repeats); a missing flag counts as false. Only for a policy that sets a
 * rule: a cached run without rules never matches it.
 */
export function snapshotHasDataPolicy(
    configSnapshot: SQLWrapper,
    policy: INormalizedDataPolicy,
): SQL {
    const cached = sql`(${configSnapshot}->'dataPolicy')`;
    const cachedHosts = sql`coalesce(${cached}->'onlyHosts', '[]'::jsonb)`;
    const hosts = JSON.stringify(policy.onlyHosts);
    return sql`(
        jsonb_typeof(${cached}) = 'object'
        and ${cachedHosts} @> ${hosts}::jsonb
        and ${hosts}::jsonb @> ${cachedHosts}
        and coalesce(${cached}->'zeroDataRetention' = 'true'::jsonb, false) = ${policy.zeroDataRetention}::boolean
        and coalesce(${cached}->'disallowPromptTraining' = 'true'::jsonb, false) = ${policy.disallowPromptTraining}::boolean
    )`;
}

/** How a run model's calls are routed, as far as answer reuse cares. */
export interface ICachedCellRoute {
    /** The provider the run chose; undefined: "auto". */
    transport: ProviderTransport | undefined;
    /** The id sent to the provider when it isn't the registry's (Bifrost). */
    transportModelId?: string;
    /**
     * For "auto", the provider this run's calls go over now. A saved answer
     * from an "auto" run is reused only when it recorded the same provider.
     */
    resolvedTransport?: string;
}

/**
 * SQL: the cached run model (an element of the cached run's
 * `config_snapshot.models`) and cell were routed the way this one is.
 */
export function cachedRouteMatches(
    cachedModel: SQLWrapper,
    providerMetadata: SQLWrapper,
    route: ICachedCellRoute,
): SQL {
    const sameRoute = sql`${cachedModel}->>'transport' is not distinct from ${route.transport ?? null}
                      and ${cachedModel}->>'transportModelId' is not distinct from ${route.transportModelId ?? null}`;
    if (route.transport !== undefined) return sameRoute;
    // "auto" picks a provider from the keys saved at call time, so the
    // provider recorded with the answer must be the one this run would use.
    return sql`${sameRoute}
                      and ${providerMetadata}->>'transport' = ${route.resolvedTransport ?? null}`;
}
