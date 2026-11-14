import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ProviderStatus } from "./provider-status";

afterEach(cleanup);

describe("ProviderStatus", () => {
    it("shows where each key comes from and where runs start", () => {
        render(
            <ProviderStatus
                status={{
                    defaultProvider: "gateway",
                    keys: [
                        { provider: "gateway", source: "env" },
                        { provider: "openrouter", source: "settings" },
                    ],
                }}
            />,
        );
        expect(screen.getByText("Key from .env")).toBeInTheDocument();
        expect(screen.getByText("Key saved in Settings")).toBeInTheDocument();
        expect(screen.getAllByText("No key")).toHaveLength(4);
        expect(screen.getByText("Anthropic")).toBeInTheDocument();
        expect(screen.getByText("Gemini API")).toBeInTheDocument();
        expect(screen.getByText("Runs start here")).toBeInTheDocument();
        expect(
            screen.getByText(/New runs start each model on Vercel AI Gateway/),
        ).toBeInTheDocument();
        expect(
            screen.getByRole("link", { name: "Models and prices" }),
        ).toHaveAttribute("href", "/models");
    });

    it("warns when no provider has a key", () => {
        render(<ProviderStatus status={{ keys: [] }} />);
        expect(
            screen.getByText(/No provider has a key, so no model can run/),
        ).toBeInTheDocument();
        expect(screen.getByText(/is "auto"/)).toBeInTheDocument();
    });
});
