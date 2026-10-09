export interface IRuntimeMetricsSnapshot {
    requestsTotal: number;
    errorsTotal: number;
    lastRequestAt?: string;
    lastErrorAt?: string;
}

const metrics: IRuntimeMetricsSnapshot = {
    requestsTotal: 0,
    errorsTotal: 0,
};

export function recordRequest(): void {
    metrics.requestsTotal += 1;
    metrics.lastRequestAt = new Date().toISOString();
}

export function recordError(): void {
    metrics.errorsTotal += 1;
    metrics.lastErrorAt = new Date().toISOString();
}

export function runtimeMetricsSnapshot(): IRuntimeMetricsSnapshot {
    return { ...metrics };
}

export function resetRuntimeMetricsForTests(): void {
    metrics.requestsTotal = 0;
    metrics.errorsTotal = 0;
    delete metrics.lastRequestAt;
    delete metrics.lastErrorAt;
}
