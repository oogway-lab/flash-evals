import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil } from "lucide-react";
import { MosaicApiError } from "@mosaic/api-contract";
import { requireActiveProject as requirePagePrincipal } from "@/server/projects/activeProject";
import { serverApiClient } from "@/server/api/client";
import { Page } from "@/components/layout/page";
import { PageHeader } from "@/components/layout/page-header";
import { CopyablePre } from "@/components/prompts/copyable-pre";
import { buttonVariants } from "@/components/ui/button";
import { Num } from "@/components/ui/num";
import { RelativeTime } from "@/components/ui/relative-time";
import { PromptStatusBadge } from "@/components/ui/status-badge";
import { SectionTitle } from "@/components/layout/section-title";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";

export const dynamic = "force-dynamic";

export default async function PromptViewPage({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const { id } = await params;
    const p = await requirePagePrincipal();
    const detail = await serverApiClient()
        .getPromptDetail(p.teamId, p.projectId, id)
        .catch((err: unknown) => {
            if (err instanceof MosaicApiError && err.status === 404) notFound();
            throw err;
        });
    const { prompt, latestVersion: version, schemaVersion, versions } = detail;
    const isEval = prompt.kind === "eval";

    return (
        <Page>
            <PageHeader
                title={prompt.name}
                description={prompt.description ?? undefined}
                breadcrumbs={[
                    { label: "Prompts", href: "/prompts" },
                    { label: prompt.name },
                ]}
                action={
                    isEval ? (
                        <Link
                            href={`/prompts/${prompt.id}/edit`}
                            className={buttonVariants()}
                        >
                            <Pencil className="h-4 w-4" />
                            Edit
                        </Link>
                    ) : undefined
                }
            />

            <section className="flex flex-col gap-4">
                <SectionTitle
                    actions={
                        version ? (
                            <PromptStatusBadge status={version.status} />
                        ) : undefined
                    }
                    description={
                        version ? (
                            <>
                                Version <Num>{version.version}</Num>
                            </>
                        ) : undefined
                    }
                >
                    Prompt
                </SectionTitle>
                {version?.content ? (
                    <CopyablePre text={version.content} label="Copy prompt" />
                ) : (
                    <p className="text-copy-14 text-muted-foreground">
                        This prompt has no content yet.
                    </p>
                )}
            </section>

            <section className="flex flex-col gap-4">
                <SectionTitle>Output schema</SectionTitle>
                {schemaVersion ? (
                    <CopyablePre
                        label="Copy output schema"
                        text={JSON.stringify(schemaVersion.jsonSchema, null, 4)}
                    />
                ) : (
                    <p className="text-copy-14 text-muted-foreground">
                        No output schema defined for this prompt.
                    </p>
                )}
            </section>

            {versions.length > 0 && (
                <section className="flex flex-col gap-4">
                    <SectionTitle>Versions</SectionTitle>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Version</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead>Created</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {versions.map((v) => (
                                <TableRow key={v.id}>
                                    <TableCell>
                                        <span className="text-label-14">
                                            v{v.version}
                                        </span>
                                        {v.optimizerAttemptId && (
                                            <span className="ml-2 text-muted-foreground">
                                                Optimized with AI
                                            </span>
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        <PromptStatusBadge status={v.status} />
                                    </TableCell>
                                    <TableCell className="text-muted-foreground">
                                        <RelativeTime value={v.createdAt} />
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </section>
            )}
        </Page>
    );
}
