"use client";

import { useId, useMemo, useState, type KeyboardEvent } from "react";
import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";

function parseTags(value: string): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of value.split(/[\n,]/)) {
        const tag = raw.trim();
        if (!tag) continue;
        const key = tag.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(tag);
    }
    return out;
}

export interface ITagInputProps {
    /** Comma/newline-joined value; stays the form's source of truth. */
    value: string;
    onChange: (value: string) => void;
    id?: string;
    name?: string;
    suggestions?: string[];
    placeholder?: string;
}

export function TagInput({
    value,
    onChange,
    id,
    name,
    suggestions = [],
    placeholder = "Add a tag",
}: ITagInputProps) {
    const [draft, setDraft] = useState("");
    const reactId = useId();
    const inputId = id ?? reactId;
    const tags = useMemo(() => parseTags(value), [value]);

    function commit(next: string[]) {
        onChange(next.join(", "));
    }

    function addTag(raw: string) {
        const tag = raw.trim();
        if (!tag) return;
        if (
            tags.some(
                (existing) => existing.toLowerCase() === tag.toLowerCase(),
            )
        ) {
            setDraft("");
            return;
        }
        commit([...tags, tag]);
        setDraft("");
    }

    function removeTag(index: number) {
        commit(tags.filter((_, i) => i !== index));
    }

    function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
        if (event.key === "Enter" || event.key === ",") {
            event.preventDefault();
            addTag(draft);
        } else if (
            event.key === "Backspace" &&
            draft === "" &&
            tags.length > 0
        ) {
            removeTag(tags.length - 1);
        }
    }

    const matches = useMemo(() => {
        const query = draft.trim().toLowerCase();
        if (!query) return [];
        const have = new Set(tags.map((tag) => tag.toLowerCase()));
        return suggestions
            .filter(
                (suggestion) =>
                    suggestion.toLowerCase().includes(query) &&
                    !have.has(suggestion.toLowerCase()),
            )
            .slice(0, 6);
    }, [draft, suggestions, tags]);

    return (
        <div>
            {name ? <input type="hidden" name={name} value={value} /> : null}
            <div className="flex min-h-10 flex-wrap items-center gap-2 rounded-sm border border-input bg-neutral px-2 py-1.5 focus-within:border-ring">
                {tags.map((tag, index) => (
                    <Badge
                        key={`${tag}-${index}`}
                        variant="outline"
                        className="gap-1 text-mono-13"
                    >
                        {tag}
                        <button
                            type="button"
                            aria-label={`Remove ${tag}`}
                            onClick={() => removeTag(index)}
                            className="rounded-sm text-muted-foreground hover:text-on-surface focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
                        >
                            <X className="h-3 w-3" />
                        </button>
                    </Badge>
                ))}
                <input
                    id={inputId}
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={onKeyDown}
                    placeholder={tags.length === 0 ? placeholder : ""}
                    className="min-w-24 flex-1 bg-transparent text-mono-13 outline-none placeholder:text-muted-foreground"
                />
            </div>
            {matches.length > 0 ? (
                <div className="flex flex-wrap gap-2 pt-2">
                    {matches.map((suggestion) => (
                        <button
                            key={suggestion}
                            type="button"
                            onClick={() => addTag(suggestion)}
                            className="rounded-sm border border-border px-2 py-0.5 text-mono-13 text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
                        >
                            {suggestion}
                        </button>
                    ))}
                </div>
            ) : null}
        </div>
    );
}
