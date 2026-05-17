import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { WorkQueuePage } from "@/components/work-queue";

export const dynamic = "force-dynamic";

export default async function ProofreaderPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  const isLiterary = user.proofreader_type === "literary";

  return (
    <WorkQueuePage
      role="proofreader"
      phase={isLiterary ? "literary_proofreading" : "proofreading"}
      title={
        isLiterary
          ? "My Literary Proofreading Workspace"
          : "My General Proofreading Workspace"
      }
      startLabel={
        isLiterary
          ? "Start Literary Proofreading"
          : "Start General Proofreading"
      }
      searchParams={(await searchParams) ?? {}}
    />
  );
}