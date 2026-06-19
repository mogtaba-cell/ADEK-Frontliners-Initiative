import { WorkQueuePage } from "@/components/work-queue";

export const dynamic = "force-dynamic";

export default async function ReviewerPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <WorkQueuePage
      role="reviewer"
      phase="final_review"
      title="My Review Workspace"
      startLabel="Start Review Workspace"
      searchParams={(await searchParams) ?? {}}
    />
  );
}
