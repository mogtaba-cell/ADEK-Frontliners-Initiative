import { WorkQueuePage } from "@/components/work-queue";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

function titleForProofreaderType(proofreaderType: string | null | undefined) {
  if (proofreaderType === "general") {
    return {
      phase: "proofreading" as const,
      title: "General Proofreading Workspace",
      startLabel: "Open General Proofreading Queue",
    };
  }

  if (proofreaderType === "literary_arabic") {
    return {
      phase: "literary_proofreading" as const,
      title: "Arabic Literary Proofreading Workspace",
      startLabel: "Open Arabic Literary Queue",
    };
  }

  if (proofreaderType === "literary_english_or_others") {
    return {
      phase: "literary_proofreading" as const,
      title: "English / Other Literary Proofreading Workspace",
      startLabel: "Open English / Other Literary Queue",
    };
  }

  // Temporary fallback for old users still marked as "literary"
  if (proofreaderType === "literary") {
    return {
      phase: "literary_proofreading" as const,
      title: "Literary Proofreading Workspace",
      startLabel: "Open Literary Proofreading Queue",
    };
  }

  return {
    phase: "proofreading" as const,
    title: "Proofreading Workspace",
    startLabel: "Open Proofreading Queue",
  };
}

export default async function ProofreaderPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser(["proofreader", "admin"]);
  const config = titleForProofreaderType(user.proofreader_type);

  return (
    <WorkQueuePage
      role="proofreader"
      phase={config.phase}
      title={config.title}
      startLabel={config.startLabel}
      searchParams={(await searchParams) ?? {}}
    />
  );
}