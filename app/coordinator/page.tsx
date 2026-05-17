import { WorkQueuePage } from "@/components/work-queue";

export const dynamic = "force-dynamic";

export default async function CoordinatorPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <WorkQueuePage
      role="coordinator"
      phase="coordinator_check"
      title="Coordinator Correction Workspace"
      startLabel="Open Correction Queue"
      filterMode="correction"
      searchParams={(await searchParams) ?? {}}
    />
  );
}