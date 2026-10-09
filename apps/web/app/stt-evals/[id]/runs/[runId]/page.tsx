import { redirect } from "next/navigation";

export default async function SttEvalRunRedirectPage({
    params,
}: {
    params: Promise<{ id: string; runId: string }>;
}) {
    const { id, runId } = await params;
    redirect(`/multiworkflow/${id}/runs/${runId}`);
}
