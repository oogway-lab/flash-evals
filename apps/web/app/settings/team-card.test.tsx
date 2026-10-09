import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { TeamCard } from "./team-card";

afterEach(cleanup);

describe("TeamCard", () => {
    it("explains that invites aren't available yet", () => {
        render(<TeamCard />);

        expect(screen.getByText("Team")).toBeInTheDocument();
        expect(screen.getByText("Coming soon")).toBeInTheDocument();
        expect(screen.getByText(/isn't available yet/)).toBeInTheDocument();
    });
});
