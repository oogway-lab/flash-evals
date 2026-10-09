import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

const twMerge = extendTailwindMerge({
    extend: {
        theme: {
            text: [
                "heading-32",
                "heading-24",
                "heading-20",
                "heading-16",
                "copy-16",
                "copy-14",
                "label-14",
                "label-12",
                "mono-13",
                "stat-32",
            ],
        },
    },
});

export function cn(...inputs: ClassValue[]): string {
    return twMerge(clsx(inputs));
}
