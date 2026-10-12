// Everything the receipt prints. Run numbers, scores, latencies, and costs are
// illustrative demo data, not benchmark results; the page labels them so.

export const REPO_URL = "https://github.com/oogway-lab/flash-evals";
export const CLONE_COMMAND = `git clone ${REPO_URL}`;
export const DOCS_URL = `${REPO_URL}/blob/main/docs/getting-started.md`;
export const MCP_DOCS_URL = `${REPO_URL}/blob/main/docs/mcp-eval-server.md`;
export const STT_DOCS_URL = `${REPO_URL}/blob/main/docs/stt-evaluations.md`;

export type Field = {
    name: string;
    got: string;
    expected?: string;
};

export type ModelResponse = {
    code: string;
    model: string;
    latencyMs: number;
    cost: string;
    fields: Field[];
};

export const item = {
    number: "017",
    total: "240",
    file: "receipt_017.jpg",
    merchant: "Corner Grocer",
    reference: [
        { name: "merchant", value: "Corner Grocer" },
        { name: "date", value: "2026-09-14" },
        { name: "total", value: "41.09" },
        { name: "tax", value: "3.12" },
        { name: "line_items", value: "6" },
    ],
};

// Listed fastest first: the demo prints each block when its latency elapses.
export const responses: ModelResponse[] = [
    {
        code: "B",
        model: "Model B",
        latencyMs: 620,
        cost: "0.0003",
        fields: [
            { name: "merchant", got: "Corner Grocer" },
            { name: "date", got: "2026-09-14" },
            { name: "total", got: "41.90", expected: "41.09" },
            { name: "tax", got: "3.12" },
            { name: "line_items", got: "6" },
        ],
    },
    {
        code: "C",
        model: "Model C",
        latencyMs: 910,
        cost: "0.0005",
        fields: [
            { name: "merchant", got: "Corner Grocer" },
            { name: "date", got: "09/14/2026", expected: "2026-09-14" },
            { name: "total", got: "41.09" },
            { name: "tax", got: "3.12" },
            { name: "line_items", got: "6" },
        ],
    },
    {
        code: "A",
        model: "Model A",
        latencyMs: 1840,
        cost: "0.0041",
        fields: [
            { name: "merchant", got: "Corner Grocer" },
            { name: "date", got: "2026-09-14" },
            { name: "total", got: "41.09" },
            { name: "tax", got: "3.12" },
            { name: "line_items", got: "6" },
        ],
    },
];

export type LeaderRow = {
    code: string;
    model: string;
    accuracy: string;
    avgLatency: string;
    costPer1k: string;
    stamp?: string;
    failures?: string;
};

export const leaderboard: LeaderRow[] = [
    {
        code: "A",
        model: "Model A",
        accuracy: "96.8%",
        avgLatency: "1.79 s",
        costPer1k: "4.12",
        stamp: "Best score",
    },
    {
        code: "B",
        model: "Model B",
        accuracy: "93.1%",
        avgLatency: "0.58 s",
        costPer1k: "0.31",
        stamp: "Fastest",
    },
    {
        code: "C",
        model: "Model C",
        accuracy: "91.4%",
        avgLatency: "0.88 s",
        costPer1k: "0.49",
    },
    {
        code: "D",
        model: "Model D",
        accuracy: "86.2%",
        avgLatency: "2.31 s",
        costPer1k: "0.22",
        stamp: "Low cost",
        failures: "3 failed results · invalid JSON",
    },
];

export const lineItems = [
    {
        qty: "1",
        item: "Datasets",
        note: "Bring text, images, or audio. Add expected answers where available.",
    },
    {
        qty: "1",
        item: "Prompts",
        note: "Define the task and output format. Test a sample before a run.",
    },
    {
        qty: "1",
        item: "Field checks",
        note: "Compare scored fields with the answers you expect.",
    },
    {
        qty: "1",
        item: "Model judges",
        note: "Score outputs against your rubric using a judge model.",
    },
    {
        qty: "1",
        item: "Time + cost",
        note: "Review response times and estimated costs where available.",
    },
    {
        qty: "1",
        item: "Workflows",
        note: "Connect prompt and evaluation steps for tasks with several stages.",
    },
    {
        qty: "1",
        item: "Audio variants",
        note: "Compare up to six transcription settings in one audio run.",
    },
    {
        qty: "1",
        item: "Agent access",
        note: "Let an MCP-compatible agent start runs and inspect results.",
    },
    {
        qty: "1",
        item: "Review notes",
        note: "Add notes and annotations to results that need attention.",
    },
    {
        qty: "1",
        item: "Result reuse",
        note: "Reuse matching stored results when reuse is enabled.",
    },
];

export type TranscriptWord = { w: string; mark?: "sub" | "miss"; ref?: string };

export const audio = {
    item: "004",
    file: "support_call_004.wav",
    duration: "0:07",
    language: "hi-en",
    reference: "Mera OTP 4829 hai, please confirm karo.",
    variants: [
        {
            code: "A",
            label: "Config A · vocabulary hint",
            words: [
                { w: "Mera" },
                { w: "OTP" },
                { w: "4829" },
                { w: "hai," },
                { w: "please" },
                { w: "confirm" },
                { w: "karo." },
            ] as TranscriptWord[],
            accuracy: "100%",
            speakers: "2 / 2",
        },
        {
            code: "B",
            label: "Config B · no hint",
            words: [
                { w: "Mera" },
                { w: "OTB", mark: "sub", ref: "OTP" },
                { w: "4829" },
                { w: "hai," },
                { w: "please" },
                { w: "confirm" },
                { w: "karo." },
            ] as TranscriptWord[],
            accuracy: "85.7%",
            speakers: "2 / 2",
        },
        {
            code: "C",
            label: "Config C · different model",
            words: [
                { w: "Mera" },
                { w: "OTP" },
                { w: "4829" },
                { w: "hi,", mark: "sub", ref: "hai," },
                { w: "please" },
                { w: "confirm" },
                { w: "karo.", mark: "miss" },
            ] as TranscriptWord[],
            accuracy: "71.4%",
            speakers: "unavailable",
        },
    ],
};

export const agentCalls = [
    { tool: "list_datasets", result: "3 datasets" },
    { tool: "create_eval_run", result: "run queued" },
    { tool: "get_run_progress", result: "720 / 960 results" },
    { tool: "get_run_summary", result: "status + progress" },
    { tool: "list_run_cells", result: "outputs + scores" },
    { tool: "save_run_note", result: "review note saved" },
];

export const installSteps = [
    `git clone ${REPO_URL}`,
    "cd flash-evals",
    "pnpm install --frozen-lockfile",
    "pnpm run setup:local",
    "docker compose up -d --wait postgres",
    "node scripts/build-packages.mjs",
    "pnpm run db:migrate",
    "pnpm run seed",
    "pnpm run dev",
];
