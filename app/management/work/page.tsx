import { WorkQueuePage } from "@/components/work-queue";

export const dynamic = "force-dynamic";

export default async function ManagementNeedsReviewPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <WorkQueuePage
      role="management"
      phase="management_review"
      title="Management Needs Review Workspace"
      startLabel="Open Review Queue"
      searchParams={(await searchParams) ?? {}}
    />
  );
}