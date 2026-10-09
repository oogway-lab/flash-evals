import { redirect } from "next/navigation";

export default async function WorkflowCanvasRedirectPage({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const { id } = await params;
    redirect(`/multiworkflow/${id}`);
}
