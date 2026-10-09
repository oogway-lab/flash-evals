import { Check, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function RunPrerequisitesCard({
    prereqs,
}: {
    prereqs: Array<{ label: string; ok: boolean }>;
}) {
    return (
        <Card>
            <CardHeader>
                <CardTitle as="h2">Prerequisites</CardTitle>
            </CardHeader>
            <CardContent>
                <ul className="flex flex-col gap-2">
                    {prereqs.map((p) => (
                        <li
                            key={p.label}
                            className="flex items-center gap-2 text-copy-14"
                        >
                            {p.ok ? (
                                <Check className="h-4 w-4 text-success" />
                            ) : (
                                <X className="h-4 w-4 text-danger" />
                            )}
                            <span
                                className={cn(!p.ok && "text-muted-foreground")}
                            >
                                {p.label}
                            </span>
                        </li>
                    ))}
                </ul>
            </CardContent>
        </Card>
    );
}
