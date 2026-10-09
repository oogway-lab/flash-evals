import {
    act,
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
    IProviderKeyMetadata,
    IWorkflowLlmRoute,
} from "@mosaic/api-contract";

vi.mock("@/app/actions/settings", () => ({
    loadWorkflowLlmRouteCandidatesAction: vi.fn(async () => ({
        result: {
            transport: "openrouter",
            coverage: "provider_model_listing",
            candidates: [
                {
                    transport: "openrouter",
                    modelId: "google/gemma-3-27b-it",
                    label: "Gemma 3 27B IT",
                    modelProvider: "google",
                    modelProviderLabel: "Gemma",
                    source: "provider_model_listing",
                    availability: "provider_listed_candidate",
                    requiresMutationDiscovery: true,
                    support: {
                        upstreamRoutingModes: ["auto"],
                        supportedGenerationControls: [
                            "maxOutputTokens",
                            "temperature",
                        ],
                        supportsStructuredOutput: true,
                    },
                },
            ],
        },
    })),
    saveWorkflowLlmRouteAction: vi.fn(),
    disableWorkflowLlmRouteAction: vi.fn(),
    setWorkflowLlmDefaultAction: vi.fn(),
    clearWorkflowLlmDefaultAction: vi.fn(),
}));

import { loadWorkflowLlmRouteCandidatesAction } from "@/app/actions/settings";
import { LlmRoutingForm } from "./llm-routing-form";

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

const keys: IProviderKeyMetadata[] = [
    {
        id: "11111111-1111-4111-8111-111111111111",
        provider: "openrouter",
        hint: "••••1234",
    },
];

const routes: IWorkflowLlmRoute[] = [
    {
        id: "33333333-3333-4333-8333-333333333333",
        teamId: "team-1",
        projectId: "project-1",
        name: "Gemma exact",
        createdAt: "2026-07-25T00:00:00.000Z",
        latestVersion: {
            id: "44444444-4444-4444-8444-444444444444",
            routeId: "33333333-3333-4333-8333-333333333333",
            version: 1,
            providerKeyId: keys[0]!.id!,
            providerKeyRotationVersion: "rotation-1",
            capabilityVersionId: "22222222-2222-4222-8222-222222222222",
            createdAt: "2026-07-25T00:00:00.000Z",
            config: {
                modelId: "google/gemma-3-27b-it",
                transportConfig: {
                    transport: "openrouter",
                    upstreamPolicy: { mode: "exact", only: ["google"] },
                    requireParameters: true,
                    responseCache: "disable",
                },
                generation: {
                    maxOutputTokens: 2048,
                    temperature: 0,
                },
                structuredOutput: { mode: "text" },
                retry: {
                    owner: "mosaic",
                    maxAttempts: 1,
                    timeoutMs: 60_000,
                    retryableErrorClasses: ["timeout"],
                },
                cache: {
                    mosaicReuse: "force_fresh",
                    providerCaching: "allow",
                },
            },
        },
    },
];

describe("LlmRoutingForm", () => {
    it("loads provider models automatically and defaults to safe evaluation settings", async () => {
        render(
            <LlmRoutingForm
                projectId="project-1"
                keys={keys}
                routes={routes}
            />,
        );

        expect(
            screen.getByText(/load its current models automatically/i),
        ).toBeInTheDocument();
        expect(
            screen.queryByRole("button", { name: /refresh capabilities/i }),
        ).not.toBeInTheDocument();
        await waitFor(() =>
            expect(screen.getByLabelText("Model")).toHaveTextContent(
                "Gemma 3 27B IT",
            ),
        );
        expect(
            screen.getByLabelText("Maximum output tokens"),
        ).toBeInTheDocument();
        expect(screen.getByLabelText("Temperature")).toBeInTheDocument();
        expect(screen.queryByLabelText("Top P")).not.toBeInTheDocument();
        expect(screen.getByLabelText("Flash Evals result reuse")).toHaveTextContent(
            "Always call provider",
        );
        expect(
            screen.getByRole("button", { name: "Create route" }),
        ).toBeInTheDocument();
    });

    it("collapses advanced controls but still submits their fields", async () => {
        const { container } = render(
            <LlmRoutingForm
                projectId="project-1"
                keys={keys}
                routes={routes}
            />,
        );
        await waitFor(() =>
            expect(screen.getByLabelText("Model")).toHaveTextContent(
                "Gemma 3 27B IT",
            ),
        );
        const trigger = screen.getByRole("button", {
            name: "Advanced controls",
        });
        expect(trigger).toHaveAttribute("aria-expanded", "false");
        const timeout = container.querySelector<HTMLInputElement>(
            'input[name="timeoutMs"]',
        );
        // Mounted but hidden (display: none), so a submit still carries the
        // default.
        expect(timeout).not.toBeNull();
        const panel = timeout?.closest('[data-slot="collapsible-content"]');
        expect(panel).toHaveAttribute("hidden");
        expect(panel).toHaveAttribute("data-closed");
        expect(new FormData(timeout!.form!).get("timeoutMs")).toBe("60000");

        fireEvent.click(trigger);
        expect(trigger).toHaveAttribute("aria-expanded", "true");
        expect(panel).not.toHaveAttribute("hidden");
        expect(panel).not.toHaveAttribute("data-closed");
    });

    it("announces model loading, shows a safe error, and retries", async () => {
        let resolveCandidates:
            | ((
                  value: Awaited<
                      ReturnType<typeof loadWorkflowLlmRouteCandidatesAction>
                  >,
              ) => void)
            | undefined;
        const pendingCandidates = new Promise<
            Awaited<ReturnType<typeof loadWorkflowLlmRouteCandidatesAction>>
        >((resolve) => {
            resolveCandidates = resolve;
        });
        vi.mocked(loadWorkflowLlmRouteCandidatesAction).mockReturnValueOnce(
            pendingCandidates,
        );

        render(
            <LlmRoutingForm
                projectId="project-1"
                keys={keys}
                routes={routes}
            />,
        );

        const loading = await screen.findByRole("status", { name: "" });
        expect(loading).toHaveTextContent("Loading current provider models");
        // Announced only; the visible cue sits in the Model trigger so the
        // fields below don't shift.
        expect(loading).toHaveClass("sr-only");
        const modelTrigger = screen.getByLabelText("Model");
        expect(modelTrigger).toHaveTextContent("Loading models…");
        expect(
            modelTrigger.querySelector('[data-slot="spinner"]'),
        ).toBeInTheDocument();

        await act(async () => {
            resolveCandidates?.({
                error: "Models are temporarily unavailable. Try again.",
            });
        });
        const errorTitle = await screen.findByText("Models unavailable");
        const errorAlert = errorTitle.closest('[role="alert"]');
        expect(errorAlert).toBeInTheDocument();
        await waitFor(() => expect(errorAlert).toHaveFocus());

        fireEvent.click(
            screen.getByRole("button", { name: "Retry model loading" }),
        );
        await waitFor(() =>
            expect(screen.getByLabelText("Model")).toHaveTextContent(
                "Gemma 3 27B IT",
            ),
        );
        expect(loadWorkflowLlmRouteCandidatesAction).toHaveBeenCalledTimes(2);
    });

    it("shows route impact, default repair guidance, and management actions", () => {
        render(
            <LlmRoutingForm
                projectId="project-1"
                keys={keys}
                routes={routes}
                projectDefault={{
                    projectId: "project-1",
                    routeVersionId: routes[0]!.latestVersion!.id,
                    updatedAt: "2026-07-25T00:00:00.000Z",
                }}
            />,
        );

        expect(screen.getByText("Current project default")).toBeInTheDocument();
        expect(
            screen.getByText(/future default resolutions only/i),
        ).toBeInTheDocument();
        expect(
            screen.getByRole("button", { name: "Clear default" }),
        ).toBeInTheDocument();
        expect(
            screen.getByRole("button", { name: "Disable route" }),
        ).toBeInTheDocument();
    });

    it("links to credentials and keeps saved routes visible when no provider is configured", () => {
        render(
            <LlmRoutingForm projectId="project-1" keys={[]} routes={routes} />,
        );

        expect(
            screen.getByRole("link", { name: "Add a provider credential" }),
        ).toHaveAttribute("href", "#provider-keys-heading");
        expect(screen.getByText("Gemma exact")).toBeInTheDocument();
        expect(
            screen.getByRole("button", { name: "Create route" }),
        ).toBeDisabled();
    });
});
