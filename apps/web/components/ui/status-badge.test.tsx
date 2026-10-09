import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import {
    BranchStatusBadge,
    CellStatusBadge,
    KeyStoredBadge,
    PendingScore,
    ProbeBadge,
    PromptStatusBadge,
    ReviewVerdictBadge,
    RunStatusBadge,
    SttGateBadge,
    TranscriptStatusBadge,
} from "./status-badge";

afterEach(cleanup);

describe("status badges", () => {
    it.each([
        ["pending", "Pending"],
        ["running", "Running"],
        ["completed", "Completed"],
        ["partial", "Partial"],
        ["failed", "Failed"],
    ] as const)("renders run status %s as %s", (status, label) => {
        render(<RunStatusBadge status={status} />);
        expect(screen.getByText(label)).toHaveAttribute(
            "aria-label",
            `Run status: ${label}`,
        );
    });

    it.each([
        ["pending", "Pending"],
        ["running", "Running"],
        ["succeeded", "Succeeded"],
        ["failed", "Failed"],
        ["cached", "Cached"],
    ] as const)("renders cell status %s as %s", (status, label) => {
        render(<CellStatusBadge status={status} />);
        expect(screen.getByText(label)).toHaveAttribute(
            "aria-label",
            `Cell status: ${label}`,
        );
    });

    it("marks running with a dot so state isn't color-only", () => {
        const { container, rerender } = render(
            <RunStatusBadge status="running" />,
        );
        expect(
            container.querySelector('[data-slot="status-running-dot"]'),
        ).toBeInTheDocument();

        rerender(<RunStatusBadge status="completed" />);
        expect(
            container.querySelector('[data-slot="status-running-dot"]'),
        ).not.toBeInTheDocument();
    });
});

describe("shared status badges", () => {
    it("labels transcript, branch and prompt statuses in sentence case", () => {
        render(
            <>
                <TranscriptStatusBadge status="completed" />
                <BranchStatusBadge status="running" />
                <PromptStatusBadge status="runnable" />
            </>,
        );
        expect(screen.getByText("Completed")).toHaveAttribute(
            "aria-label",
            "Transcript status: Completed",
        );
        expect(screen.getByText("Running branch")).toBeInTheDocument();
        expect(screen.getByText("Runnable")).toBeInTheDocument();
    });

    it("renders key and probe states as text", () => {
        render(
            <>
                <KeyStoredBadge stored={false} />
                <ProbeBadge failed={false} verified={false} />
                <ProbeBadge failed verified={false} />
            </>,
        );
        expect(screen.getByText("Not stored")).toBeInTheDocument();
        expect(screen.getByText("Not verified")).toBeInTheDocument();
        expect(screen.getByText("Failed")).toBeInTheDocument();
    });

    it("names a pending score for assistive tech", () => {
        render(<PendingScore />);
        expect(screen.getByText("Score pending")).toHaveClass("sr-only");
    });

    it("pairs a verdict with its text", () => {
        render(<ReviewVerdictBadge verdict="issue" />);
        expect(screen.getByLabelText("Review: Issue")).toHaveTextContent(
            "Issue",
        );
    });

    it("marks the STT gate pass as success", () => {
        render(
            <SttGateBadge
                gate={
                    { status: "pass" } as Parameters<
                        typeof SttGateBadge
                    >[0]["gate"]
                }
            />,
        );
        expect(screen.getByText("Pass")).toHaveClass("text-eval-success");
    });
});
