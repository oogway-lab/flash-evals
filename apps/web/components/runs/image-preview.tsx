import { LazyImage } from "@/components/ui/lazy-image";
import { cn } from "@/lib/cn";

export function ImagePreview({
    storageKey,
    alt,
    fallback = "Image unavailable",
    className,
}: {
    storageKey: string;
    alt: string;
    fallback?: string;
    className?: string;
}) {
    return (
        <div
            className={cn(
                "flex aspect-video overflow-hidden rounded-sm bg-muted",
                className,
            )}
        >
            <LazyImage
                src={`/api/images/${storageKey}`}
                alt={alt}
                fallback={fallback}
            />
        </div>
    );
}
