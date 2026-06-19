import { WorkQueuePage } from "@/components/work-queue";

export const dynamic = "force-dynamic";

export default async function RaterPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <WorkQueuePage
      role="rater"
      phase="artistic_ranking"
      title="Artistic Ranking Workspace"
      startLabel="Open Artistic Ranking Queue"
      searchParams={(await searchParams) ?? {}}
    />
  );
}
