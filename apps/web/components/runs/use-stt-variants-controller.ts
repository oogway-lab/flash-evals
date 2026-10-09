"use client";

import { useState } from "react";
import {
    MAX_STT_VARIANTS,
    type IRunSetupSttModelOption,
    type ISttRunVariant,
} from "@mosaic/api-contract";
import { configForSttModel } from "./stt-config-fields";

export interface ISttVariantDraft {
    variantKey: string;
    label: string;
    modelId: string;
    language: string;
    config: Record<string, unknown>;
}

function newVariantKey(): string {
    return `v-${crypto.randomUUID().slice(0, 8)}`;
}

export function useSttVariantsController(
    sttModels: IRunSetupSttModelOption[],
    initialVariants?: ISttRunVariant[],
) {
    const defaultModelId =
        sttModels.find((model) => model.available)?.id ??
        sttModels[0]?.id ??
        "";
    const [variants, setVariants] = useState<ISttVariantDraft[]>(() =>
        initialVariants?.length
            ? initialVariants.map((variant) => ({
                  variantKey: variant.variantKey,
                  label: variant.label,
                  modelId: variant.config.modelId,
                  language: variant.config.language ?? "",
                  config: variant.config.config ?? {},
              }))
            : [
                  {
                      variantKey: "v1",
                      label: "Variant 1",
                      modelId: defaultModelId,
                      language: "",
                      config: {},
                  },
              ],
    );

    const update = (
        variantKey: string,
        updater: (variant: ISttVariantDraft) => ISttVariantDraft,
    ) =>
        setVariants((current) =>
            current.map((variant) =>
                variant.variantKey === variantKey ? updater(variant) : variant,
            ),
        );

    return {
        variants,
        canAdd: variants.length < MAX_STT_VARIANTS,
        add() {
            setVariants((current) => {
                if (current.length >= MAX_STT_VARIANTS) return current;
                const number = current.length + 1;
                return [
                    ...current,
                    {
                        variantKey: newVariantKey(),
                        label: `Variant ${number}`,
                        modelId: defaultModelId,
                        language: "",
                        config: {},
                    },
                ];
            });
        },
        duplicate(variantKey: string) {
            setVariants((current) => {
                if (current.length >= MAX_STT_VARIANTS) return current;
                const source = current.find(
                    (variant) => variant.variantKey === variantKey,
                );
                if (!source) return current;
                return [
                    ...current,
                    {
                        ...source,
                        variantKey: newVariantKey(),
                        label: `${source.label} copy`,
                        config: { ...source.config },
                    },
                ];
            });
        },
        remove(variantKey: string) {
            setVariants((current) =>
                current.length === 1
                    ? current
                    : current.filter(
                          (variant) => variant.variantKey !== variantKey,
                      ),
            );
        },
        updateLabel(variantKey: string, label: string) {
            update(variantKey, (variant) => ({ ...variant, label }));
        },
        updateLanguage(variantKey: string, language: string) {
            update(variantKey, (variant) => ({ ...variant, language }));
        },
        updateConfig(variantKey: string, config: Record<string, unknown>) {
            update(variantKey, (variant) => ({
                ...variant,
                config,
            }));
        },
        updateModel(variantKey: string, modelId: string) {
            const model = sttModels.find((model) => model.id === modelId);
            update(variantKey, (variant) => ({
                ...variant,
                modelId,
                config: configForSttModel(variant.config, model),
            }));
        },
    };
}
