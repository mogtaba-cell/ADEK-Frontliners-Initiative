import { WorkQueuePage } from "@/components/work-queue";

export const dynamic = "force-dynamic";

export default async function RaterWorkspacePage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <WorkQueuePage
      role="rater"
      phase="artistic_ranking"
      title="Artistic Grading Workspace"
      startLabel="Open Artistic Grading Queue"
      searchParams={(await searchParams) ?? {}}
    />
  );
}
