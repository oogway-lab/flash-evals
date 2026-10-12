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
        model: "google/gemini-2.5-flash-lite",
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
        model: "openai/gpt-4o-mini",
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
        model: "anthropic/claude-sonnet-4.5",
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
    p50: string;
    costPer1k: string;
    stamp?: string;
    failures?: string;
};

export const leaderboard: LeaderRow[] = [
    {
        code: "A",
        model: "anthropic/claude-sonnet-4.5",
        accuracy: "96.8%",
        p50: "1.79 s",
        costPer1k: "4.12",
        stamp: "Most accurate",
    },
    {
        code: "B",
        model: "google/gemini-2.5-flash-lite",
        accuracy: "93.1%",
        p50: "0.58 s",
        costPer1k: "0.31",
        stamp: "Fastest",
    },
    {
        code: "C",
        model: "openai/gpt-4o-mini",
        accuracy: "91.4%",
        p50: "0.88 s",
        costPer1k: "0.49",
    },
    {
        code: "D",
        model: "google/gemma-3-27b-it",
        accuracy: "86.2%",
        p50: "2.31 s",
        costPer1k: "0.22",
        stamp: "Cheapest",
        failures: "3 hard failures · invalid JSON",
    },
];

export const lineItems = [
    {
        qty: "1",
        item: "Datasets",
        note: "Your own text, images, and audio, with reference labels.",
    },
    {
        qty: "1",
        item: "Prompts",
        note: "Task instructions with a structured output schema.",
    },
    {
        qty: "1",
        item: "Field-level diffs",
        note: "Every structured answer checked against its label.",
    },
    {
        qty: "1",
        item: "LLM judges",
        note: "A model scores outputs against the rubric you write.",
    },
    {
        qty: "1",
        item: "Latency + cost",
        note: "Recorded per cell. Costs are estimates, labeled as such.",
    },
    {
        qty: "1",
        item: "Workflows",
        note: "Chain prompt steps into a graph when one prompt is not enough.",
    },
    {
        qty: "6",
        item: "STT variants",
        note: "Compare up to six transcription configs per audio run.",
    },
    {
        qty: "88",
        item: "MCP tools",
        note: "Agents work with the same datasets, runs, and notes.",
    },
    {
        qty: "1",
        item: "Review notes",
        note: "Annotate the cases that need a human look.",
    },
    {
        qty: "1",
        item: "Result reuse",
        note: "An exact repeat is served from your stored result, not re-billed.",
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
            label: "soniox/stt-async-v5 · keyword boost",
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
            label: "soniox/stt-async-v5 · no boost",
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
            label: "openai/gpt-4o-transcribe",
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
            speakers: "not supported",
        },
    ],
};

export const agentCalls = [
    { tool: "list_datasets", result: "3 datasets" },
    { tool: "create_eval_run", result: "run 0413 queued" },
    { tool: "get_run_progress", result: "180 / 240 cells" },
    { tool: "get_run_summary", result: "leader: claude-sonnet-4.5" },
    { tool: "list_run_cells", result: "12 cells below 0.6" },
    { tool: "save_run_note", result: "note saved" },
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
