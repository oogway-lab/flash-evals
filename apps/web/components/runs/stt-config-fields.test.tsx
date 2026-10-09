import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
    STT_STANDARD_CONFIG_FIELDS,
    sttConfigFieldsForModelId,
    type IRunSetupSttModelOption,
} from "@mosaic/api-contract";
import {
    SttConfigFields,
    configForSttModel,
    configForSttSnapshot,
    sttConfigForModel,
} from "./stt-config-fields";

afterEach(cleanup);

function model(id: string): IRunSetupSttModelOption {
    return {
        id,
        label: id,
        providerLabel: "Provider",
        available: true,
        configFields: sttConfigFieldsForModelId(id),
        ...(id === "openai:gpt-4o-transcribe-diarize"
            ? { outputKind: "diarized_transcript" as const }
            : {}),
    };
}

function ConfigHarness({
    modelId = "soniox:stt-async-v5",
}: {
    modelId?: string;
}) {
    const [language, setLanguage] = useState("");
    const [config, setConfig] = useState<Record<string, unknown>>({});
    return (
        <>
            <SttConfigFields
                model={model(modelId)}
                language={language}
                config={config}
                onLanguageChange={setLanguage}
                onConfigChange={setConfig}
            />
            <output>{JSON.stringify({ language, config })}</output>
        </>
    );
}

describe("SttConfigFields", () => {
    it("renders the canonical template in order for every model", () => {
        const { container, rerender } = render(<ConfigHarness />);
        const controlIds = () =>
            Array.from(
                container.querySelectorAll<HTMLInputElement>(
                    ':is(input, textarea, button)[id^="stt-"]',
                ),
            ).map((control) => control.id);

        expect(controlIds()).toEqual(
            STT_STANDARD_CONFIG_FIELDS.map((field) => `stt-${field.key}`),
        );

        rerender(<ConfigHarness modelId="openai:gpt-4o-transcribe" />);
        expect(controlIds()).toEqual(
            STT_STANDARD_CONFIG_FIELDS.map((field) => `stt-${field.key}`),
        );
    });

    it("enables only Soniox capabilities and associates disabled notes", () => {
        render(<ConfigHarness />);

        expect(screen.getByLabelText("Audio language")).toBeEnabled();
        expect(screen.getByLabelText("Context")).toBeEnabled();
        expect(screen.getByLabelText("Diarization")).toBeEnabled();
        expect(screen.getByLabelText("Keyword boost")).toBeEnabled();

        const thinking = screen.getByLabelText("Thinking effort");
        expect(thinking).toBeDisabled();
        expect(thinking).toHaveAttribute("aria-disabled", "true");
        const describedBy = thinking.getAttribute("aria-describedby") ?? "";
        const unavailableId = describedBy
            .split(" ")
            .find((id) => id.endsWith("-unavailable"));
        expect(unavailableId).toBeTruthy();
        expect(document.getElementById(unavailableId!)).toHaveTextContent(
            "Not applicable to this model",
        );

        fireEvent.change(screen.getByLabelText("Audio language"), {
            target: { value: "ta" },
        });
        fireEvent.change(screen.getByLabelText("Context"), {
            target: { value: "Flash Evals product names" },
        });
        fireEvent.click(screen.getByLabelText("Diarization"));
        fireEvent.change(screen.getByLabelText("Keyword boost"), {
            target: { value: "Avalon, Brightwater" },
        });

        expect(screen.getByRole("status")).toHaveTextContent(
            JSON.stringify({
                language: "ta",
                config: {
                    context: "Flash Evals product names",
                    diarization: true,
                    keywords: "Avalon, Brightwater",
                },
            }),
        );
    });

    it("enables GPT-4o prompt while leaving diarization visible and disabled", () => {
        render(
            <SttConfigFields
                model={model("openai:gpt-4o-transcribe")}
                language=""
                config={{}}
                onLanguageChange={() => undefined}
                onConfigChange={() => undefined}
            />,
        );
        expect(screen.getByLabelText("Initial prompt")).toBeEnabled();
        expect(screen.getByLabelText("Diarization")).toBeDisabled();
        expect(
            screen.getByLabelText("Diarization"),
        ).toHaveAccessibleDescription(/Not applicable to this model/);
    });

    it("shows diarization as always-on for diarized-output models", () => {
        render(<ConfigHarness modelId="openai:gpt-4o-transcribe-diarize" />);
        const diarization = screen.getByRole("checkbox", {
            name: /speaker-separated/i,
        });
        expect(diarization).toBeDisabled();
        expect(diarization).toBeChecked();
        expect(diarization).toHaveAccessibleDescription(
            /Always on for this model/,
        );
        expect(diarization).not.toHaveAccessibleDescription(
            /Not applicable to this model/,
        );
    });

    it("flips enablement in place when the model changes", () => {
        const props = {
            language: "",
            config: { prompt: "names", context: "domain" },
            onLanguageChange: () => undefined,
            onConfigChange: () => undefined,
        };
        const { rerender } = render(
            <SttConfigFields model={model("whisper-1")} {...props} />,
        );
        expect(screen.getByLabelText("Initial prompt")).toBeEnabled();
        expect(screen.getByLabelText("Context")).toBeDisabled();

        rerender(
            <SttConfigFields model={model("soniox:stt-async-v5")} {...props} />,
        );
        expect(screen.getByLabelText("Initial prompt")).toBeDisabled();
        expect(screen.getByLabelText("Initial prompt")).toHaveValue("");
        expect(screen.getByLabelText("Context")).toBeEnabled();
        expect(screen.getByLabelText("Context")).toHaveValue("domain");
    });

    it("drops undeclared keys on a model switch without changing nodeConfig shape", () => {
        const whisper = model("whisper-1");
        expect(
            configForSttModel(
                {
                    context: "names",
                    diarization: true,
                    keywords: "Flash Evals",
                    prompt: "spell Flash Evals correctly",
                },
                whisper,
            ),
        ).toEqual({
            keywords: "Flash Evals",
            prompt: "spell Flash Evals correctly",
        });
        expect(
            sttConfigForModel(
                {
                    modelId: "soniox:stt-async-v5",
                    language: "en",
                    config: { context: "names", diarization: true },
                },
                whisper,
            ),
        ).toEqual({ modelId: "whisper-1", language: "en" });
    });

    it("normalizes numeric canvas fields for persistence", () => {
        const gemini = model("gemini:gemini-2.5-flash");
        expect(
            configForSttSnapshot(
                {
                    temperature: "0.25",
                    thinkingBudgetTokens: "1024",
                    prompt: "Keep names exact",
                    unknown: "drop me",
                },
                gemini,
            ),
        ).toEqual({
            temperature: 0.25,
            thinkingBudgetTokens: 1024,
            prompt: "Keep names exact",
        });
        expect(
            configForSttSnapshot(
                { temperature: "", thinkingBudgetTokens: "not-a-number" },
                gemini,
            ),
        ).toEqual({});
    });

    it("excludes disabled values from serialized config", () => {
        expect(
            configForSttSnapshot(
                {
                    context: "Keep this",
                    prompt: "Drop this",
                    thinking: "high",
                },
                model("soniox:stt-async-v5"),
            ),
        ).toEqual({ context: "Keep this" });
    });
});
