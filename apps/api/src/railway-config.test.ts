import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Railway build config", () => {
    it("uses Railpack so the workspace pnpm version pin is honored", () => {
        const config = JSON.parse(
            readFileSync(
                new URL("../../../railway.json", import.meta.url),
                "utf8",
            ),
        ) as { build?: { builder?: string } };

        expect(config.build?.builder).toBe("RAILPACK");
    });
});
