import { describe, expect, it } from "vitest";
import { cn } from "./cn";

describe("cn", () => {
    it("keeps custom typography utilities alongside semantic text colors", () => {
        expect(
            cn(
                "text-label-14 text-primary-foreground",
                "h-8 px-2.5 text-label-12",
            ),
        ).toContain("text-primary-foreground");
    });
});
