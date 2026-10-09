import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import type { ILeaderboardRow } from "@mosaic/api-contract";
import { Leaderboard } from "./leaderboard";

afterEach(cleanup);

function row(overrides: Partial<ILeaderboardRow>): ILeaderboardRow {
    return {
        runModelId: "rm-1",
        modelId: "model-1",
        isReference: false,
        n: 10,
        avgFieldScore: 0.5,
        avgJudgeScore: 0.5,
        avgTranscriptScore: undefined,
        avgTranscriptJudgeScore: undefined,
        avgWer: undefined,
        avgCer: undefined,
        avgCpWer: undefined,
        avgSttLatencyMs: undefined,
        p95SttLatencyMs: undefined,
        totalSttCostUsd: undefined,
        p95LatencyMs: undefined,
        transcriptFailureCount: 0,
        avgLatencyMs: 1000,
        avgPromptTokens: 100,
        avgCompletionTokens: 100,
        avgTotalTokens: 200,
        totalCostUsd: 1,
        projectedCostPer1k: 10,
        costAvailable: true,
        tokenUsageAvailable: true,
        ...overrides,
    };
}

const ROWS: ILeaderboardRow[] = [
    row({
        runModelId: "rm-ref",
        modelId: "reference-model",
        isReference: true,
        avgJudgeScore: 0.6,
        totalCostUsd: 3,
    }),
    row({
        runModelId: "rm-cheap",
        modelId: "cheap-model",
        avgJudgeScore: 0.4,
        totalCostUsd: 0.5,
    }),
    row({
        runModelId: "rm-best",
        modelId: "best-judge-model",
        avgJudgeScore: 0.9,
        totalCostUsd: 2,
    }),
];

function sortHeader(container: HTMLElement, name: RegExp): HTMLElement {
    const header = Array.from(container.querySelectorAll("th")).find((th) =>
        name.test(th.querySelector("button")?.textContent ?? ""),
    );
    if (!header) throw new Error(`No sortable header matching ${name}`);
    return header;
}

function bodyModelOrder(container: HTMLElement): string[] {
    const tbody = container.querySelector("tbody")!;
    return within(tbody)
        .getAllByRole("row")
        .map((r) => within(r).getAllByRole("cell")[0].textContent ?? "");
}

describe("Leaderboard", () => {
    it("defaults to best judge score first", () => {
        const { container } = render(<Leaderboard rows={ROWS} />);
        const order = bodyModelOrder(container);
        expect(order[0]).toContain("best-judge-model");
        expect(order[2]).toContain("cheap-model");

        const sorted = container.querySelector('th[aria-sort="descending"]');
        expect(sorted?.textContent).toContain("Judge score");
    });

    it("defaults to transcript score on STT runs and to cost without scores", () => {
        const stt = [
            row({
                runModelId: "rm-a",
                modelId: "stt-a",
                avgJudgeScore: undefined,
                avgTranscriptScore: 0.6,
                avgWer: 0.4,
                avgCer: 0.2,
            }),
            row({
                runModelId: "rm-b",
                modelId: "stt-b",
                avgJudgeScore: undefined,
                avgTranscriptScore: 0.9,
                avgWer: 0.1,
                avgCer: 0.05,
            }),
        ];
        const { container, unmount } = render(<Leaderboard rows={stt} />);
        expect(bodyModelOrder(container)[0]).toContain("stt-b");
        expect(
            container.querySelector('th[aria-sort="descending"]')?.textContent,
        ).toContain("Transcript score");
        unmount();

        const unscored = [
            row({
                runModelId: "rm-x",
                modelId: "costly",
                avgJudgeScore: undefined,
                totalCostUsd: 5,
            }),
            row({
                runModelId: "rm-y",
                modelId: "frugal",
                avgJudgeScore: undefined,
                totalCostUsd: 1,
            }),
        ];
        const second = render(<Leaderboard rows={unscored} />);
        expect(bodyModelOrder(second.container)[0]).toContain("frugal");
        expect(
            second.container.querySelector('th[aria-sort="ascending"]')
                ?.textContent,
        ).toContain("Total cost");
    });

    it("does not render the projected cost columns", () => {
        const { container } = render(<Leaderboard rows={ROWS} />);
        const headers = Array.from(container.querySelectorAll("th")).map(
            (th) => th.textContent ?? "",
        );
        expect(headers.some((h) => h.includes("Projected"))).toBe(false);
        expect(headers.some((h) => h.includes("cost/1k"))).toBe(false);
    });

    it("sorts by total cost ascending when its header is clicked", () => {
        const { getByRole, container } = render(<Leaderboard rows={ROWS} />);
        fireEvent.click(getByRole("button", { name: /Total cost/ }));

        expect(bodyModelOrder(container)[0]).toContain("cheap-model");
        expect(
            sortHeader(container, /Total cost/).getAttribute("aria-sort"),
        ).toBe("ascending");
    });

    it("renders transcript metric summary when STT scores are present", () => {
        const rows = [
            row({
                runModelId: "rm-stt",
                modelId: "soniox",
                avgTranscriptScore: 0.82,
                avgWer: 0.18,
                avgCer: 0.07,
                transcriptFailureCount: 2,
            }),
        ];

        const { container, getByRole } = render(<Leaderboard rows={rows} />);
        expect(getByRole("button", { name: /Transcript score/ })).toBeTruthy();
        const tbody = container.querySelector("tbody")!;
        expect(within(tbody).getByText("0.82")).toBeTruthy();
        expect(within(tbody).getByText("0.18")).toBeTruthy();
        expect(within(tbody).getByText("0.07")).toBeTruthy();
        expect(within(tbody).getByText("2")).toBeTruthy();
    });

    it("toggles direction on repeated clicks of the same header", () => {
        const { getByRole, container } = render(<Leaderboard rows={ROWS} />);
        const btn = getByRole("button", { name: /Judge score/ });
        // Judge score starts descending (best first).
        fireEvent.click(btn); // asc
        expect(bodyModelOrder(container)[0]).toContain("cheap-model");
        expect(
            sortHeader(container, /Judge score/).getAttribute("aria-sort"),
        ).toBe("ascending");
        fireEvent.click(btn); // desc again
        expect(bodyModelOrder(container)[0]).toContain("best-judge-model");
    });

    it("renders an sr-only summary naming the current leader", () => {
        const { container } = render(<Leaderboard rows={ROWS} />);
        const summary = container.querySelector(".sr-only");
        expect(summary?.textContent).toContain("best-judge-model");
        expect(summary?.textContent).toContain("3 models compared");
    });

    it("uses tooltips, not native title attributes", () => {
        const { container } = render(
            <Leaderboard
                rows={ROWS.map((r) => ({
                    ...r,
                    costAvailable: false,
                    tokenUsageAvailable: false,
                }))}
            />,
        );
        expect(container.querySelectorAll("[title]")).toHaveLength(0);
    });

    it("keeps the reference badge intact", () => {
        const { container } = render(<Leaderboard rows={ROWS} />);
        // The badge renders in both the desktop table and the mobile card
        // list (both stay in the DOM); scope to the table to assert it once.
        const tbody = container.querySelector("tbody")!;
        expect(within(tbody).getByText("Reference")).toBeTruthy();
    });

    it("right-aligns numeric columns and shows missing values as an en dash", () => {
        const { container } = render(
            <Leaderboard
                rows={[
                    row({
                        avgJudgeScore: undefined,
                        totalCostUsd: undefined,
                    }),
                ]}
            />,
        );
        const table = container.querySelector("table")!;
        // The second header row holds the metric columns; the first holds
        // the Quality / Speed / Usage group labels.
        const headerRow = table.querySelectorAll("thead tr")[1] as HTMLElement;
        const headers = within(headerRow).getAllByRole("columnheader");
        expect(headers[0]).not.toHaveClass("text-right");
        for (const header of headers.slice(1)) {
            expect(header).toHaveClass("text-right");
        }
        const cells = within(table).getAllByRole("cell");
        // Judge score and total cost are missing for this row.
        expect(cells[1].textContent).toContain("–");
        expect(cells.at(-1)?.textContent).toContain("–");
        expect(table.textContent).not.toContain("—");
    });

    it("shows an empty state instead of an empty table", () => {
        const { container } = render(<Leaderboard rows={[]} />);
        expect(container.querySelector("table")).toBeNull();
        expect(
            within(container).getByText("No results yet"),
        ).toBeInTheDocument();
    });

    it("labels the reference row's comparisons as the baseline", () => {
        const { container } = render(<Leaderboard rows={ROWS} />);
        const tbody = container.querySelector("tbody")!;
        const refRow = within(tbody)
            .getAllByRole("row")
            .find((r) => r.textContent?.includes("reference-model"))!;
        // Judge and latency "vs reference" cells.
        expect(within(refRow).getAllByText("Baseline")).toHaveLength(2);
    });

    it("describes latency changes as faster or slower", () => {
        const rows = [
            row({
                runModelId: "rm-ref",
                modelId: "reference-model",
                isReference: true,
                avgLatencyMs: 1000,
            }),
            row({
                runModelId: "rm-fast",
                modelId: "fast-model",
                avgLatencyMs: 770,
            }),
        ];
        const { container } = render(<Leaderboard rows={rows} />);
        const tbody = container.querySelector("tbody")!;
        expect(within(tbody).getByText("23% faster")).toBeInTheDocument();
    });

    it("marks the single best value in a column and skips ties", () => {
        const rows = [
            row({
                runModelId: "rm-ref",
                modelId: "reference-model",
                isReference: true,
                avgLatencyMs: 3271,
                totalCostUsd: 0.0002,
            }),
            row({
                runModelId: "rm-fast",
                modelId: "fast-model",
                avgLatencyMs: 2531,
                totalCostUsd: 0.0002,
            }),
        ];
        const { container } = render(<Leaderboard rows={rows} />);
        const table = container.querySelector("table")!;
        const fastRow = within(table)
            .getAllByRole("row")
            .find((r) => r.textContent?.includes("fast-model"))!;
        const refRow = within(table)
            .getAllByRole("row")
            .find((r) => r.textContent?.includes("reference-model"))!;
        // Latency is the only column with a unique winner: judge scores,
        // tokens, and cost all tie.
        expect(within(fastRow).getAllByText("Best")).toHaveLength(1);
        expect(within(refRow).queryByText("Best")).toBeNull();
    });

    it("hides the judge column on STT runs without a judge score", () => {
        const rows = [
            row({
                runModelId: "rm-stt",
                modelId: "soniox",
                avgJudgeScore: undefined,
                avgTranscriptScore: 1,
                avgWer: 0,
                avgCer: 0,
            }),
        ];
        const { container, queryByRole, getByText } = render(
            <Leaderboard rows={rows} />,
        );
        expect(queryByRole("button", { name: /Judge score/ })).toBeNull();
        expect(
            getByText("No judge prompt on this run, so judge score is hidden."),
        ).toBeInTheDocument();
        expect(container.querySelector("table")!.textContent).toContain(
            "Quality",
        );
    });
});
