"use client";

import { useCallback, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/cn";

export interface ILazyImageProps {
    src: string;
    alt: string;
    /** Shown in place of the image when it fails to load. */
    fallback?: string;
    className?: string;
}

type LoadState = "loading" | "loaded" | "failed";

function LazyImageInner({
    src,
    alt,
    fallback = "Image unavailable",
    className,
}: ILazyImageProps) {
    const [state, setState] = useState<LoadState>("loading");
    // A server-rendered image can finish (or fail) before hydration attaches
    // onLoad/onError, so read its state when the element mounts.
    const imageRef = useCallback((image: HTMLImageElement | null) => {
        if (image?.complete) {
            setState(image.naturalWidth > 0 ? "loaded" : "failed");
        }
    }, []);

    return (
        <div
            data-slot="lazy-image"
            className={cn("relative h-full w-full", className)}
        >
            {state === "failed" ? (
                <div className="flex h-full w-full items-center justify-center border border-border p-2">
                    <p className="text-center text-label-12 text-muted-foreground">
                        {fallback}
                    </p>
                </div>
            ) : (
                <>
                    {state === "loading" && (
                        <Skeleton className="absolute inset-0 rounded-none" />
                    )}
                    <img
                        ref={imageRef}
                        src={src}
                        alt={alt}
                        loading="lazy"
                        decoding="async"
                        onLoad={() => setState("loaded")}
                        onError={() => setState("failed")}
                        className={cn(
                            "h-full w-full object-cover transition-opacity duration-200",
                            state === "loaded" ? "opacity-100" : "opacity-0",
                        )}
                    />
                </>
            )}
        </div>
    );
}

/**
 * An image that fills its container: lazy-loaded, a skeleton until it loads,
 * a short fade-in, and a text fallback if it fails.
 */
export function LazyImage(props: ILazyImageProps) {
    // Reset the load state when the source changes.
    return <LazyImageInner key={props.src} {...props} />;
}
