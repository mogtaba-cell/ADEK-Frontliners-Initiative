import { WorkQueuePage } from "@/components/work-queue";

export const dynamic = "force-dynamic";

export default async function LiterarySubcategorizerPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <WorkQueuePage
      role="literary_subcategorizer"
      phase="literary_subcategorization"
      title="Literary Subcategory Workspace"
      startLabel="Open Literary Subcategory Queue"
      searchParams={(await searchParams) ?? {}}
    />
  );
}
