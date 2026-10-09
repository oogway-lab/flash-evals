import { redirect } from "next/navigation";

export default async function WorkflowRedirectPage({
    params,
    searchParams,
}: {
    params: Promise<{ id: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
    const { id } = await params;
    // The canvas reads `datasetId` from the query to preselect a run dataset,
    // so a legacy link carrying one must keep it across the redirect.
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(await searchParams)) {
        if (typeof value === "string") query.set(key, value);
        else if (Array.isArray(value))
            for (const item of value) query.append(key, item);
    }
    const search = query.toString();
    redirect(`/multiworkflow/${id}${search ? `?${search}` : ""}`);
}
