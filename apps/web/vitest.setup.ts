import "@testing-library/jest-dom/vitest";
import { afterEach, expect } from "vitest";

// jsdom has no ResizeObserver; Base UI (scroll areas, select and menu
// popups, tabs indicator) uses it to measure. A no-op stand-in is enough for
// tests. Nothing else is polyfilled: Base UI works in jsdom without it.
if (typeof globalThis.ResizeObserver === "undefined") {
    globalThis.ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
    } as unknown as typeof ResizeObserver;
}

// Vitest doesn't fail on console output, so a component switching between
// controlled and uncontrolled (Base UI and React warn) would pass silently.
// Record those messages and fail the test that produced them.
const CONTROLLED_SWITCH =
    /changing from (?:un)?controlled to (?:un)?controlled|changing an? (?:un)?controlled input to be (?:un)?controlled/i;
const controlledSwitchMessages: string[] = [];

function recordControlledSwitch(
    original: (...args: unknown[]) => void,
): (...args: unknown[]) => void {
    return (...args) => {
        const message = args.map(String).join(" ");
        if (CONTROLLED_SWITCH.test(message)) {
            controlledSwitchMessages.push(message);
        }
        original(...args);
    };
}

console.warn = recordControlledSwitch(console.warn.bind(console));
console.error = recordControlledSwitch(console.error.bind(console));

afterEach(() => {
    const messages = controlledSwitchMessages.splice(0);
    expect(messages, "controlled/uncontrolled switch warnings").toEqual([]);
});
