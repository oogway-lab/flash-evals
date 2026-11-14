import { describe, expect, it } from "vitest";
import {
    inputPart,
    inputTemplateErrors,
    renderTemplate,
    type ITemplateStep,
} from "./stepTemplates.js";

const item = [
    "<call_date>2026-03-02</call_date>",
    "<user_persona>Store manager</user_persona>",
    "<transcript>",
    "Agent: Hello.",
    "</transcript>",
].join("\n");

const steps = new Map<string, ITemplateStep>([
    [
        "extract",
        {
            label: "Extract",
            status: "succeeded",
            answer: {
                title: "Restock call",
                product: "Snack box",
                customer_details: { region: "North" },
                internal: "x",
            },
        },
    ],
    ["notes", { label: "Notes", status: "skipped" }],
]);

describe("input templates", () => {
    it("reads tagged sections, the whole input and JSON fields", () => {
        expect(inputPart(item, "transcript")).toBe("Agent: Hello.");
        expect(inputPart(item, "user_persona")).toBe("Store manager");
        expect(inputPart(item, undefined)).toBe(item);
        expect(inputPart(item, "missing")).toBeUndefined();
        expect(inputPart('{"customer":{"name":"Ana"}}', "customer.name")).toBe(
            "Ana",
        );
    });

    const persona = [
        '<user_persona>{\n  "name": "Sam Rivera",\n  "user_id": "u-1",\n  "home": {"city": "Pune"}\n}</user_persona>',
        "<transcript>Agent: Hi.</transcript>",
        "<conversation_datetime_utc>2026-11-08T09:30:00.000000+00:00</conversation_datetime_utc>",
    ].join("\n");

    it("reads a field of the JSON inside a tagged section", () => {
        expect(inputPart(persona, "user_persona.name")).toBe("Sam Rivera");
        expect(inputPart(persona, "user_persona.user_id")).toBe("u-1");
        expect(inputPart(persona, "user_persona.home.city")).toBe("Pune");
        expect(inputPart(persona, "user_persona.home")).toEqual({
            city: "Pune",
        });
        expect(
            renderTemplate("Name: {{input.user_persona.name}}", {
                input: persona,
                steps,
            }),
        ).toBe("Name: Sam Rivera");
    });

    it("prefers a section named exactly with the dots", () => {
        const dotted =
            '<user_persona.name>Exact</user_persona.name><user_persona>{"name":"Inner"}</user_persona>';
        expect(inputPart(dotted, "user_persona.name")).toBe("Exact");
        const longest = '<a.b>{"c":"long"}</a.b><a>{"b":{"c":"short"}}</a>';
        expect(inputPart(longest, "a.b.c")).toBe("long");
    });

    it("treats a missing field or non-JSON section as missing", () => {
        expect(inputPart(persona, "user_persona.age")).toBeUndefined();
        expect(inputPart(persona, "transcript.speaker")).toBeUndefined();
        expect(inputPart(item, "user_persona.name")).toBeUndefined();
        expect(
            renderTemplate('{{input.transcript.x | default:"n/a"}}', {
                input: persona,
                steps,
            }),
        ).toBe("n/a");
        // A whole section is still read as text, JSON or not.
        expect(inputPart(persona, "transcript")).toBe("Agent: Hi.");
        expect(inputPart(persona, "conversation_datetime_utc")).toBe(
            "2026-11-08T09:30:00.000000+00:00",
        );
    });

    it("writes sections and earlier answers into the message", () => {
        expect(
            renderTemplate(
                "Date: {{input.call_date}}\n{{input.transcript}}\nTitle: {{Extract.$.title}}",
                { input: item, steps },
            ),
        ).toBe("Date: 2026-03-02\nAgent: Hello.\nTitle: Restock call");
    });

    it("picks several fields into one JSON object", () => {
        expect(
            renderTemplate(
                "{{Extract.$ | pick:title,product,customer_details}}",
                { input: item, steps },
            ),
        ).toBe(
            '{"title":"Restock call","product":"Snack box","customer_details":{"region":"North"}}',
        );
    });

    it("uses | default when the value is missing or empty", () => {
        expect(
            renderTemplate(
                '{{input.call_date | default:"unknown"}} / {{Notes.$.text | default:"Not discussed"}} / {{input.missing | default:"n/a"}}',
                { input: item, steps },
            ),
        ).toBe("2026-03-02 / Not discussed / n/a");
    });

    it("writes nothing for a skipped step or a missing field", () => {
        expect(
            renderTemplate("[{{Notes.$.text}}][{{Extract.$.nope}}]", {
                input: item,
                steps,
            }),
        ).toBe("[][]");
    });
});

describe("input template checks", () => {
    const labels = new Map([
        ["extract", "Extract"],
        ["notes", "Notes"],
        ["write", "Write"],
    ]);

    it("accepts steps upstream of this one", () => {
        expect(
            inputTemplateErrors(
                "{{input.transcript}} {{extract.$.title}}",
                "Write",
                labels,
                new Set(["extract"]),
            ),
        ).toEqual([]);
        expect(
            inputTemplateErrors(
                "{{input.user_persona.name}}",
                "Write",
                labels,
                new Set(),
            ),
        ).toEqual([]);
    });

    it("says plainly what is wrong", () => {
        const upstream = new Set(["extract"]);
        expect(
            inputTemplateErrors("{{Notes.$.text}}", "Write", labels, upstream),
        ).toEqual([
            'The input template of "Write" reads "Notes", which doesn\'t run before it. Connect it upstream of "Write" (an order-only connection is enough).',
        ]);
        expect(
            inputTemplateErrors("{{Other.$.x}}", "Write", labels, upstream),
        ).toEqual([
            'The input template of "Write" names "Other", which is not a step.',
        ]);
        expect(
            inputTemplateErrors("{{title}}", "Write", labels, upstream)[0],
        ).toContain("isn't a placeholder");
        expect(
            inputTemplateErrors(
                "{{Extract.$ | upper}}",
                "Write",
                labels,
                upstream,
            )[0],
        ).toContain('unknown filter "upper"');
        expect(
            inputTemplateErrors(
                "{{Extract.$.title | default}}",
                "Write",
                labels,
                upstream,
            )[0],
        ).toContain("needs the text to use");
        expect(inputTemplateErrors(" ", "Write", labels, upstream)).toEqual([
            'Step "Write" has an empty input template.',
        ]);
    });
});

describe("malformed input templates", () => {
    it("reports a template that is not text instead of throwing", () => {
        expect(
            inputTemplateErrors(
                { text: "x" } as never,
                "Notes",
                new Map(),
                new Set(),
            ),
        ).toEqual(['Step "Notes" needs its input template as text.']);
    });
});

describe("default after pick", () => {
    it("fills in when pick finds none of its fields", () => {
        expect(
            renderTemplate('{{Extract.$ | pick:a | default:"none"}}', {
                steps: new Map([
                    [
                        "extract",
                        {
                            status: "succeeded" as const,
                            label: "Extract",
                            answer: { b: 1 },
                        },
                    ],
                ]),
            }),
        ).toBe("none");
    });
});
