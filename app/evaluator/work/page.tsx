import { WorkQueuePage } from "@/components/work-queue";

export const dynamic = "force-dynamic";

export default async function EvaluatorWorkPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <WorkQueuePage
      role="evaluator"
      phase="adek_evaluation"
      title="My ADEK Evaluation Workspace"
      startLabel="Start Evaluation Workspace"
      searchParams={(await searchParams) ?? {}}
    />
  );
}
