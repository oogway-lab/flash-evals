"use client";

import * as React from "react";

type Snapshot = Array<
    | { el: HTMLInputElement; kind: "checked"; value: boolean }
    | {
          el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
          kind: "value";
          value: string;
      }
>;

function snapshot(form: HTMLFormElement): Snapshot {
    const saved: Snapshot = [];
    for (const el of Array.from(form.elements)) {
        if (el instanceof HTMLInputElement) {
            if (el.type === "file" || el.type === "hidden") continue;
            if (el.type === "checkbox" || el.type === "radio") {
                saved.push({ el, kind: "checked", value: el.checked });
            } else {
                saved.push({ el, kind: "value", value: el.value });
            }
        } else if (
            el instanceof HTMLTextAreaElement ||
            el instanceof HTMLSelectElement
        ) {
            saved.push({ el, kind: "value", value: el.value });
        }
    }
    return saved;
}

/**
 * React 19 resets a form after every `<form action={fn}>` submission, failed
 * ones included, which wipes uncontrolled fields (`defaultValue`) and loses
 * what the user typed. Render this inside such a form to put those values
 * back. Controlled fields are unaffected either way; to clear fields after a
 * successful save, remount them (e.g. with a `key`).
 */
export function KeepFieldsOnReset() {
    const markerRef = React.useRef<HTMLSpanElement>(null);
    React.useEffect(() => {
        const form = markerRef.current?.closest("form");
        if (!form) return;
        const onReset = () => {
            // The reset event fires before the fields are cleared.
            const saved = snapshot(form);
            setTimeout(() => {
                for (const entry of saved) {
                    if (!entry.el.isConnected) continue;
                    if (entry.kind === "checked") {
                        entry.el.checked = entry.value;
                    } else {
                        entry.el.value = entry.value;
                    }
                }
            }, 0);
        };
        form.addEventListener("reset", onReset);
        return () => form.removeEventListener("reset", onReset);
    }, []);
    return <span ref={markerRef} hidden />;
}
