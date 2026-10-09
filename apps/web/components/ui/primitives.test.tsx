import { afterEach, describe, expect, it, vi } from "vitest";
import {
    act,
    cleanup,
    fireEvent,
    render,
    screen,
} from "@testing-library/react";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "./alert-dialog";
import { Card, CardTitle, CardContent, CardFooter } from "./card";
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from "./collapsible";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogTitle,
} from "./dialog";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "./dropdown-menu";
import { Skeleton } from "./skeleton";
import { Spinner } from "./spinner";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "./tooltip";

afterEach(cleanup);

// Base UI opens a hover tooltip on `mouseenter` followed by a `mousemove`.
function hover(element: HTMLElement) {
    fireEvent.mouseEnter(element);
    fireEvent.mouseMove(element);
}

describe("Skeleton", () => {
    it("is hidden from assistive tech and uses the muted token", () => {
        const { container } = render(<Skeleton className="h-4 w-24" />);
        const el = container.firstElementChild!;
        expect(el).toHaveAttribute("aria-hidden", "true");
        expect(el).toHaveClass(
            "rounded-sm",
            "bg-muted",
            "animate-pulse",
            "h-4",
        );
    });
});

describe("Spinner", () => {
    it("is decorative by default", () => {
        const { container } = render(<Spinner />);
        const svg = container.querySelector("svg")!;
        expect(svg).toHaveAttribute("aria-hidden", "true");
        expect(svg).toHaveClass("animate-spin", "size-4");
    });

    it("announces itself when given a label, and supports the sm size", () => {
        render(<Spinner size="sm" label="Loading runs" />);
        const status = screen.getByRole("status", { name: "Loading runs" });
        expect(status).toHaveClass("size-3.5");
    });
});

describe("Tooltip", () => {
    it("renders content with the inverted token surface when open", () => {
        render(
            <TooltipProvider>
                <Tooltip open>
                    <TooltipTrigger>Cost</TooltipTrigger>
                    <TooltipContent>USD per 1k rows</TooltipContent>
                </Tooltip>
            </TooltipProvider>,
        );
        const surface = screen.getByRole("tooltip");
        expect(surface).toHaveTextContent("USD per 1k rows");
        expect(surface).toHaveClass(
            "bg-primary",
            "rounded-sm",
            "text-primary-foreground",
            "text-label-12",
        );
    });
});

describe("Tooltip provider", () => {
    it("uses the app's provider when one is above it", async () => {
        vi.useFakeTimers();
        try {
            render(
                <TooltipProvider delay={0}>
                    <Tooltip>
                        <TooltipTrigger>Cost</TooltipTrigger>
                        <TooltipContent>USD per 1k rows</TooltipContent>
                    </Tooltip>
                </TooltipProvider>,
            );
            hover(screen.getByText("Cost"));
            // Without the provider's 0ms delay this would wait 300ms.
            await act(async () => {
                vi.advanceTimersByTime(50);
            });
            expect(screen.getByRole("tooltip")).toHaveTextContent(
                "USD per 1k rows",
            );
        } finally {
            vi.useRealTimers();
        }
    });

    it("lets a neighbour open without the delay right after one closes", async () => {
        vi.useFakeTimers();
        try {
            render(
                <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger>Cost</TooltipTrigger>
                        <TooltipContent>First hint</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                        <TooltipTrigger>Latency</TooltipTrigger>
                        <TooltipContent>Second hint</TooltipContent>
                    </Tooltip>
                </TooltipProvider>,
            );
            hover(screen.getByText("Cost"));
            await act(async () => {
                vi.advanceTimersByTime(350);
            });
            expect(screen.getByRole("tooltip")).toHaveTextContent("First hint");

            fireEvent.mouseLeave(screen.getByText("Cost"));
            hover(screen.getByText("Latency"));
            await act(async () => {
                vi.advanceTimersByTime(20);
            });
            // Shared provider: inside the timeout window, no 300ms wait.
            expect(screen.getByRole("tooltip")).toHaveTextContent(
                "Second hint",
            );
        } finally {
            vi.useRealTimers();
        }
    });

    it("still works with no provider above it", () => {
        render(
            <Tooltip open>
                <TooltipTrigger>Cost</TooltipTrigger>
                <TooltipContent>USD per 1k rows</TooltipContent>
            </Tooltip>,
        );
        expect(screen.getByRole("tooltip")).toBeInTheDocument();
    });
});

describe("AlertDialog", () => {
    it("orders Cancel before the destructive action and fires the action", () => {
        const onConfirm = vi.fn();
        render(
            <AlertDialog open>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete dataset?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={onConfirm}>
                            Delete
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>,
        );
        const dialog = screen.getByRole("alertdialog", {
            name: "Delete dataset?",
        });
        expect(dialog).toHaveAccessibleDescription("This cannot be undone.");
        const buttons = screen.getAllByRole("button");
        expect(buttons.map((b) => b.textContent)).toEqual(["Cancel", "Delete"]);
        expect(buttons[1]).toHaveClass(
            "bg-destructive",
            "focus-visible:outline-ring",
        );
        fireEvent.click(buttons[1]);
        expect(onConfirm).toHaveBeenCalledOnce();
    });
});

describe("DropdownMenu", () => {
    it("renders items in a rounded-md floating panel", () => {
        render(
            <DropdownMenu open>
                <DropdownMenuTrigger>Actions</DropdownMenuTrigger>
                <DropdownMenuContent>
                    <DropdownMenuItem>Rename</DropdownMenuItem>
                    <DropdownMenuItem variant="destructive">
                        Delete
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>,
        );
        expect(screen.getByRole("menu")).toHaveClass(
            "rounded-md",
            "bg-neutral",
        );
        const items = screen.getAllByRole("menuitem");
        expect(items).toHaveLength(2);
        expect(items[1]).toHaveClass("text-error");
    });
});

describe("Collapsible", () => {
    it("toggles content and exposes state for the rotating chevron", () => {
        render(
            <Collapsible>
                <CollapsibleTrigger>Raw output</CollapsibleTrigger>
                <CollapsibleContent>Hidden body</CollapsibleContent>
            </Collapsible>,
        );
        const trigger = screen.getByRole("button", { name: "Raw output" });
        expect(trigger).toHaveAttribute("aria-expanded", "false");
        expect(trigger).toHaveClass("focus-visible:outline-ring");
        expect(screen.queryByText("Hidden body")).not.toBeInTheDocument();
        const chevron = trigger.querySelector(
            '[data-slot="collapsible-chevron"]',
        );
        expect(chevron).toHaveClass("group-data-[panel-open]:rotate-90");
        expect(trigger).not.toHaveAttribute("data-panel-open");

        fireEvent.click(trigger);
        expect(trigger).toHaveAttribute("aria-expanded", "true");
        expect(trigger).toHaveAttribute("data-panel-open");
        expect(screen.getByText("Hidden body")).toBeInTheDocument();
    });
});

describe("Card and Dialog extensions", () => {
    it("renders an inset Card on the surface fill without a border", () => {
        render(<Card variant="inset">Region</Card>);
        const card = screen.getByText("Region");
        expect(card).toHaveClass("bg-surface");
        expect(card).not.toHaveClass("border");
        expect(card).toHaveAttribute("data-variant", "inset");
    });

    it("renders CardTitle as h3 by default and h2 on request", () => {
        render(
            <>
                <CardTitle>Sub</CardTitle>
                <CardTitle as="h2">Top</CardTitle>
            </>,
        );
        expect(screen.getByRole("heading", { level: 3 })).toHaveClass(
            "text-heading-16",
        );
        expect(screen.getByRole("heading", { level: 2 })).toBeInTheDocument();
    });

    it("renders a CardFooter inside a Card", () => {
        render(
            <Card>
                <CardContent>Body</CardContent>
                <CardFooter>Footer</CardFooter>
            </Card>,
        );
        expect(screen.getByText("Footer")).toHaveClass("flex", "p-4", "pt-0");
    });

    it("wires DialogDescription to the dialog and lays out DialogFooter", () => {
        render(
            <Dialog open>
                <DialogContent>
                    <DialogTitle>Rename</DialogTitle>
                    <DialogDescription>Pick a new name.</DialogDescription>
                    <DialogFooter>Actions</DialogFooter>
                </DialogContent>
            </Dialog>,
        );
        expect(
            screen.getByRole("dialog", { name: "Rename" }),
        ).toHaveAccessibleDescription("Pick a new name.");
        expect(screen.getByText("Actions")).toHaveClass("sm:justify-end");
    });
});
