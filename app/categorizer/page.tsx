import { WorkQueuePage } from "@/components/work-queue";

export const dynamic = "force-dynamic";

export default async function CategorizerPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <WorkQueuePage
      role="categorizer"
      phase="categorization"
      title="Categorization Workspace"
      startLabel="Open Categorization Queue"
      searchParams={(await searchParams) ?? {}}
    />
  );
}
