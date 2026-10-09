import {
    act,
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/actions/settings", () => ({
    setProviderKeyAction: vi.fn(),
    clearProviderKeyAction: vi.fn(),
    createSttRouteProbeAction: vi.fn(),
}));

import {
    createSttRouteProbeAction,
    setProviderKeyAction,
} from "@/app/actions/settings";
import { ProviderKeysForm } from "./keys-form";

afterEach(cleanup);

const OPENAI_KEY = [
    { id: "key-openai", provider: "openai" as const, hint: "••••1234" },
];

describe("ProviderKeysForm", () => {
    it("renders accessible password labels and only supported base URL fields", () => {
        render(<ProviderKeysForm keys={[]} />);
        expect(screen.getAllByLabelText("API key")).toHaveLength(6);
        expect(screen.getAllByLabelText(/Base URL/)).toHaveLength(2);
        for (const input of screen.getAllByLabelText("API key")) {
            expect(input).toHaveAttribute("type", "password");
        }
        expect(screen.getByLabelText("Base URL (required)")).toBeRequired();
    });

    it("shows only the stored hint and provides a clear action", () => {
        render(
            <ProviderKeysForm
                keys={[
                    {
                        id: "key-openai",
                        provider: "openai",
                        hint: "••••1234",
                    },
                ]}
            />,
        );
        expect(screen.getByText("••••1234")).toBeInTheDocument();
        expect(
            screen.getByRole("button", { name: "Clear stored key" }),
        ).toBeInTheDocument();
    });

    it("shows probe-enabled routes only when the provider key is stored", () => {
        const probes = [
            {
                modelId: "gemini:gemini-2.5-flash",
                label: "Gemini 2.5 Flash audio",
                providerId: "gemini" as const,
                providerLabel: "Gemini",
                routeId: "gemini-generate-content-audio",
                availabilityStatus: "unverified_route" as const,
            },
        ];
        const { rerender } = render(
            <ProviderKeysForm
                keys={[]}
                probes={probes}
                projectId="project-1"
            />,
        );
        expect(
            screen.queryByRole("button", {
                name: "Verify Gemini 2.5 Flash audio route",
            }),
        ).not.toBeInTheDocument();

        rerender(
            <ProviderKeysForm
                keys={[
                    {
                        id: "key-gemini",
                        provider: "gemini",
                        hint: "••••1234",
                    },
                ]}
                probes={probes}
                projectId="project-1"
            />,
        );
        expect(
            screen.getByRole("button", {
                name: "Verify Gemini 2.5 Flash audio route",
            }),
        ).toBeInTheDocument();
        expect(
            screen.getByText("gemini-generate-content-audio"),
        ).toBeInTheDocument();
    });

    it("keeps key management visible when route probes are unavailable", () => {
        render(
            <ProviderKeysForm
                keys={[]}
                probeNotice="Route verification is temporarily unavailable."
            />,
        );
        expect(
            screen.getByText("Route verification is temporarily unavailable."),
        ).toBeInTheDocument();
        expect(screen.getAllByLabelText("API key")).toHaveLength(6);
    });

    it("keeps a stored key's input behind Replace key", () => {
        render(<ProviderKeysForm keys={OPENAI_KEY} />);
        // Five providers without a key show the input; OpenAI does not.
        expect(screen.getAllByLabelText("API key")).toHaveLength(5);
        expect(
            screen.getByRole("button", { name: "Replace key" }),
        ).toBeInTheDocument();
    });

    it("opens the form focused on Replace key and returns focus on Cancel", async () => {
        render(<ProviderKeysForm keys={OPENAI_KEY} />);
        fireEvent.click(screen.getByRole("button", { name: "Replace key" }));
        expect(screen.getAllByLabelText("API key")).toHaveLength(6);
        const input = document.getElementById("openai-key");
        expect(input).toHaveFocus();
        expect(
            screen.getByText(/replace the current team key/),
        ).toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
        expect(document.getElementById("openai-key")).toBeNull();
        await waitFor(() =>
            expect(
                screen.getByRole("button", { name: "Replace key" }),
            ).toHaveFocus(),
        );
    });

    it("folds the form away again after a successful replace", async () => {
        vi.mocked(setProviderKeyAction).mockResolvedValueOnce({
            ok: true,
            message: "Key saved.",
            resetKey: 1,
        });
        render(<ProviderKeysForm keys={OPENAI_KEY} />);
        fireEvent.click(screen.getByRole("button", { name: "Replace key" }));
        fireEvent.change(document.getElementById("openai-key")!, {
            target: { value: "sk-new" },
        });
        await act(async () => {
            fireEvent.submit(
                document.getElementById("openai-key")!.closest("form")!,
            );
        });
        await waitFor(() =>
            expect(document.getElementById("openai-key")).toBeNull(),
        );
        expect(
            screen.getByRole("button", { name: "Replace key" }),
        ).toBeInTheDocument();
    });

    it("offers show/hide on every key input", () => {
        render(<ProviderKeysForm keys={[]} />);
        expect(
            screen.getAllByRole("button", { name: "Show key" }),
        ).toHaveLength(6);
    });

    it("shows a probe transcript as its own labelled block", async () => {
        vi.mocked(createSttRouteProbeAction).mockResolvedValueOnce({
            result: {
                modelId: "gemini:gemini-2.5-flash",
                routeId: "gemini-generate-content-audio",
                status: "available",
                transcript: "The quick brown fox.",
                probedAt: "2026-09-27T00:00:00.000Z",
            },
        });
        render(
            <ProviderKeysForm
                keys={[
                    { id: "key-gemini", provider: "gemini", hint: "••••1234" },
                ]}
                probes={[
                    {
                        modelId: "gemini:gemini-2.5-flash",
                        label: "Gemini 2.5 Flash audio",
                        providerId: "gemini",
                        providerLabel: "Gemini",
                        routeId: "gemini-generate-content-audio",
                        availabilityStatus: "unverified_route",
                    },
                ]}
                projectId="project-1"
            />,
        );
        await act(async () => {
            fireEvent.click(
                screen.getByRole("button", {
                    name: "Verify Gemini 2.5 Flash audio route",
                }),
            );
        });
        expect(
            await screen.findByText("Sample transcript"),
        ).toBeInTheDocument();
        expect(screen.getByText("The quick brown fox.")).toBeInTheDocument();
        expect(
            screen.getByText("Route verified with the bundled sample."),
        ).toBeInTheDocument();
        expect(screen.queryByText(/^Transcript:/)).toBeNull();
    });
});
