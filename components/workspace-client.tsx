"use client";

import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { ProofreaderType, Role, WorkflowPhase } from "@/lib/types";
import { labelPhase, labelWorkflowStatus, statusClassName } from "@/lib/workflow";
import {
  LITERARY_SUBCATEGORY_DISPLAY_LABELS,
  LITERARY_SUBCATEGORY_OPTIONS,
  formatLiterarySubcategoryLabel,
} from "@/lib/literary-subcategories";
import {
  LITERARY_LANGUAGE_DISPLAY_LABELS,
  LITERARY_LANGUAGE_OPTIONS,
  formatLiteraryLanguageLabel,
} from "@/lib/literary-languages";
import {
  calculateArtisticRubricTotal,
  finalArtisticRatingFromScore,
} from "@/lib/rater-rubric";

type Assignment = {
  id: string;
  phase: WorkflowPhase;
  status: string;
  submission_id: string;
  requested_by_user_id?: string | null;
  return_to_user_id?: string | null;
  correction_reason?: string | null;
  correction_notes?: string | null;
  correction_source_phase?: string | null;
  correction_source_assignment_id?: string | null;
  proofreader_type?: string | null;
  decision?: string | null;
  coordinator_comment?: string | null;
  coordinator_waiting_for_response?: boolean | null;
  coordinator_waiting_for_response_at?: string | null;
  submissions?: any;
  task_history?: any[];
};

const correctionReasonLabels: Record<string, string> = {
  artwork_mismatch:
    "Artwork Mismatch: The uploaded artwork file link does not correspond with the text narrative or description provided.",
  incomplete_narrative:
    "Incomplete Narrative: Required narrative fields are blank, missing, or incomplete.",
  inappropriate_flagged_content:
    "Inappropriate / Flagged Content: Sensitive, inappropriate, or guideline-violating content requires coordinator revision.",
  literary_needs_review: "Literary proofreader requested Management review.",
  literary_needs_correction:
    "Literary proofreader requested correction after checking publication suitability.",
  adek_file_quality:
    "Artwork file quality / clarity issue: the submitted image, video, or audio file cannot be evaluated clearly.",
  no_school_response: "No response from school.",
  incomplete_faulty_after_correction:
    "New submission remains incomplete/faulty after correction.",
};

const correctionSourceLabels: Record<string, string> = {
  adek_evaluation: "ADEK Evaluation",
  proofreading: "General Proofreading",
  literary_proofreading: "Literary Proofreading",
  final_review: "Review",
  categorization: "Categorization",
  artistic_ranking: "Artistic Grading",
  literary_subcategorization: "Literary Subcategorization",
  coordinator_check: "Coordinator Correction",
};

const artisticRatingLabels: Record<string, string> = {
  weak: "ضعيف / Weak",
  medium: "متوسط / Medium",
  good: "جيد / Good",
  excellent: "ممتاز / Excellent",
};

const categorizationPathways = [
  "Visual Expressions",
  "Digital Expressions",
  "Performing Expressions",
  "Others & STEAM Expressions",
  "Literary Expressions",
];

function defaultCategorizedPathway(submission: any) {
  const current = String(submission?.categorized_pathway ?? "").trim();
  if (categorizationPathways.includes(current)) return current;

  const imported = String(submission?.art_pathway_name_en ?? "").trim();
  if (categorizationPathways.includes(imported)) return imported;

  return "";
}

function rawText(rawData: any, keys: string[]) {
  if (!rawData || typeof rawData !== "object") return "";

  for (const key of keys) {
    const value = rawData[key];

    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }

  return "";
}

function displayText(value: unknown, fallback = "—") {
  if (value === null || value === undefined || String(value).trim() === "") {
    return fallback;
  }

  return String(value);
}

function integerOrDefault(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function fallbackText(submission: any, directValue: unknown, rawKeys: string[]) {
  if (
    directValue !== null &&
    directValue !== undefined &&
    String(directValue).trim() !== ""
  ) {
    return directValue;
  }

  return rawText(submission.raw_data, rawKeys);
}

function normalizeGrade(value: unknown) {
  const raw = String(value ?? "").trim();

  if (!raw) return "";

  return raw
    .split(";")
    .map((item) => {
      const match = item.match(/grade\s*([0-9]{1,2})/i);
      if (match) return `Grade ${Number(match[1])}`;
      return item.trim();
    })
    .filter(Boolean)
    .join("; ");
}

function calculateAdekDecisionLabel(a: string, b: string, c: string) {
  const cultural = a === "yes";
  const artistic = b === "yes";
  const ethical = c === "yes";

  if (cultural && artistic && ethical) {
    return {
      label: "Approved",
      className: "decision-approved",
    };
  }

  if (!cultural || !ethical) {
    return {
      label: "Disqualified",
      className: "decision-disqualified",
    };
  }

  return {
    label: "Needs Review",
    className: "decision-needs-review",
  };
}

function calculateArtisticRatingLabel(rating: string) {
  const normalized = String(rating ?? "").trim().toLowerCase();

  if (normalized === "outstanding") {
    return {
      label: "Outstanding",
      className: "decision-outstanding",
    };
  }

  if (normalized === "excellent") {
    return {
      label: "Excellent",
      className: "decision-approved",
    };
  }

  if (normalized === "very good") {
    return {
      label: "Very Good",
      className: "decision-very-good",
    };
  }

  if (normalized === "average") {
    return {
      label: "Average",
      className: "decision-needs-review",
    };
  }

  return {
    label: "Weak",
    className: "decision-disqualified",
  };
}

function getCorrectionSourceLabel(value: string | null | undefined) {
  if (!value) return "Unknown phase";
  return correctionSourceLabels[value] ?? labelPhase(value) ?? value;
}

function isLiteraryExpressionsSubmission(submission: any) {
  const pathwayEn = String(submission?.art_pathway_name_en ?? "")
    .trim()
    .toLowerCase();
  const pathwayAr = String(submission?.art_pathway_name_ar ?? "")
    .trim()
    .toLowerCase();

  return (
    pathwayEn === "literary expressions" ||
    pathwayAr === "التعبيرات الأدبية" ||
    pathwayAr === "التعبيرات الادبية"
  );
}

function getDerivedFields(submission: any) {
  const englishTitle = fallbackText(submission, submission.artwork_title_en, [
    "ArtWorkTitleEn",
    "ArtworkTitleEn",
    "Artwork Title En",
    "TitleEn",
    "English Title",
    "Artwork Name",
    "Name",
  ]);

  const arabicTitle = fallbackText(submission, submission.artwork_title_ar, [
    "ArtWorkTitleAr",
    "ArtworkTitleAr",
    "Artwork Title Ar",
    "TitleAr",
    "Arabic Title",
  ]);

  const englishDescription = fallbackText(submission, submission.description_en, [
    "ArtWorkDescrEn",
    "ArtworkDescriptionEn",
    "DescriptionEn",
    "NarrativeEn",
    "English Description",
  ]);

  const arabicDescription = fallbackText(submission, submission.description_ar, [
    "ArtWorkDescrAr",
    "ArtworkDescriptionAr",
    "DescriptionAr",
    "NarrativeAr",
    "Arabic Description",
  ]);

  const studentNames = fallbackText(
    submission,
    submission.participating_students_names,
    [
      "ParticipatingStudentsNamesEn",
      "ParticipatingStudentsNames",
      "StudentNames",
      "StudentsNames",
      "Student Names",
      "Student Name",
      "Student Full Name",
    ]
  );

  return {
    artworkName: displayText(
      englishTitle,
      displayText(arabicTitle, submission.reference_id)
    ),
    englishTitle,
    arabicTitle,
    englishDescription,
    arabicDescription,
    studentNames,
    arabicPathway: fallbackText(submission, submission.art_pathway_name_ar, [
      "ArtPathwayNameAr",
    ]),
    arabicSubpathway: fallbackText(
      submission,
      submission.art_sub_pathway_name_ar,
      ["ArtSubPathwayNameAr"]
    ),
    influence: fallbackText(submission, submission.influence_idea_source, [
      "Did anyone or anything influence your idea (family, artist, place)?",
      "Did anyone or anything influence your idea",
    ]),
    enjoyable: fallbackText(submission, submission.most_enjoyable_part, [
      "What was the most enjoyable part of creating your work?",
      "Most enjoyable part",
    ]),
    elements: fallbackText(submission, submission.focused_elements, [
      "What elements did you focus on, and why?",
      "What elements did you focus on",
    ]),
  };
}

function getOriginalImportedFields(submission: any) {
  return {
    englishTitle: rawText(submission.raw_data, [
      "ArtWorkTitleEn",
      "ArtworkTitleEn",
      "Artwork Title En",
      "TitleEn",
      "English Title",
    ]),
    arabicTitle: rawText(submission.raw_data, [
      "ArtWorkTitleAr",
      "ArtworkTitleAr",
      "Artwork Title Ar",
      "TitleAr",
      "Arabic Title",
    ]),
    englishDescription: rawText(submission.raw_data, [
      "ArtWorkDescrEn",
      "ArtworkDescriptionEn",
      "DescriptionEn",
      "NarrativeEn",
      "English Description",
    ]),
    arabicDescription: rawText(submission.raw_data, [
      "ArtWorkDescrAr",
      "ArtworkDescriptionAr",
      "DescriptionAr",
      "NarrativeAr",
      "Arabic Description",
    ]),
    influence: rawText(submission.raw_data, [
      "Did anyone or anything influence your idea (family, artist, place)?",
      "Did anyone or anything influence your idea",
    ]),
    enjoyable: rawText(submission.raw_data, [
      "What was the most enjoyable part of creating your work?",
      "Most enjoyable part",
    ]),
    elements: rawText(submission.raw_data, [
      "What elements did you focus on, and why?",
      "What elements did you focus on",
    ]),
  };
}

function DetailField({ label, value }: { label: string; value: unknown }) {
  return (
    <>
      <dt>{label}</dt>
      <dd dir="auto">{displayText(value)}</dd>
    </>
  );
}

function TextBlock({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="submission-text-block">
      <strong>{label}</strong>
      <div dir="auto">{displayText(value)}</div>
    </div>
  );
}

function ComparisonRow({
  label,
  original,
  updated,
}: {
  label: string;
  original: unknown;
  updated: unknown;
}) {
  return (
    <div
      className="grid grid-2"
      style={{
        gap: 12,
        padding: "14px 0",
        borderTop: "1px solid rgba(28, 62, 59, 0.12)",
      }}
    >
      <div className="submission-text-block">
        <strong>Original {label}</strong>
        <div dir="auto">{displayText(original)}</div>
      </div>

      <div className="submission-text-block">
        <strong>Updated / Proofread {label}</strong>
        <div dir="auto">{displayText(updated)}</div>
      </div>
    </div>
  );
}

function ReviewerOriginalUpdatedComparison({
  submission,
  derived,
}: {
  submission: any;
  derived: ReturnType<typeof getDerivedFields>;
}) {
  const original = getOriginalImportedFields(submission);

  return (
    <div className="card">
      <div className="table-title-row">
        <div>
          <h3 style={{ marginTop: 0 }}>Original vs Updated Content</h3>
          <p className="muted">
            Review the original imported text beside the latest proofread or
            updated version before marking the artwork as ready.
          </p>
        </div>
      </div>

      <ComparisonRow
        label="English Title"
        original={original.englishTitle}
        updated={derived.englishTitle}
      />

      <ComparisonRow
        label="Arabic Title"
        original={original.arabicTitle}
        updated={derived.arabicTitle}
      />

      <ComparisonRow
        label="English Description"
        original={original.englishDescription}
        updated={derived.englishDescription}
      />

      <ComparisonRow
        label="Arabic Description"
        original={original.arabicDescription}
        updated={derived.arabicDescription}
      />

      <ComparisonRow
        label="Influence / Idea Source"
        original={original.influence}
        updated={derived.influence}
      />

      <ComparisonRow
        label="Most Enjoyable Part"
        original={original.enjoyable}
        updated={derived.enjoyable}
      />

      <ComparisonRow
        label="Focused Elements"
        original={original.elements}
        updated={derived.elements}
      />

      {submission.literary_updated_content && (
        <ComparisonRow
          label="Literary Updated Content"
          original=""
          updated={submission.literary_updated_content}
        />
      )}
    </div>
  );
}

function TaskHistory({ history }: { history: any[] }) {
  if (!history?.length) return null;

  return (
    <div className="card">
      <h3>Task Flow</h3>

      <div className="task-flow-list">
        {history.map((item) => (
          <div className="task-flow-item" key={item.id}>
            <span className={statusClassName(item.status)}>{item.status}</span>

            <strong>{labelPhase(item.phase)}</strong>

            <span className="muted small">
              {item.assigned_user?.full_name
                ? `Assigned to: ${item.assigned_user.full_name}`
                : "Assigned user unavailable"}
              {item.assigned_user?.proofreader_type
                ? ` (${item.assigned_user.proofreader_type})`
                : ""}
            </span>

            {item.requested_by_user?.full_name && (
              <span className="muted small">
                Requested by: {item.requested_by_user.full_name}
              </span>
            )}

            {item.return_to_user?.full_name && (
              <span className="muted small">
                Returns to: {item.return_to_user.full_name}
              </span>
            )}

            {item.correction_source_phase && (
              <span className="muted small">
                Correction source:{" "}
                {getCorrectionSourceLabel(item.correction_source_phase)}
              </span>
            )}

            {item.correction_reason && (
              <span className="muted small">
                Reason:{" "}
                {correctionReasonLabels[item.correction_reason] ??
                  item.correction_reason}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function SourceButtons({ submission }: { submission: any }) {
  const hasSource = Boolean(submission?.art_link);
  const hasUpdated = Boolean(submission?.updated_artwork_file_url);

  if (!hasSource && !hasUpdated) return null;

  return (
    <div className="actions" style={{ marginTop: 12 }}>
      {hasSource && (
        <a
          className="btn secondary"
          href={submission.art_link}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open Source File
        </a>
      )}

      {hasUpdated && (
        <a
          className="btn secondary"
          href={submission.updated_artwork_file_url}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open Updated File
        </a>
      )}
    </div>
  );
}

function CorrectionSourceCard({
  assignment,
  submission,
}: {
  assignment: Assignment;
  submission: any;
}) {
  if (!assignment.correction_reason && !assignment.correction_source_phase) {
    return null;
  }

  const evaluatorComment = displayText(submission?.evaluator_comment, "");
  const literaryComment = displayText(submission?.literary_proofreader_comment, "");

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Correction Request Details</h3>

      <dl className="detail-grid">
        <DetailField
          label="Correction requested from"
          value={getCorrectionSourceLabel(assignment.correction_source_phase)}
        />

        <DetailField
          label="Correction reason"
          value={
            correctionReasonLabels[assignment.correction_reason ?? ""] ??
            assignment.correction_reason
          }
        />

        {assignment.correction_source_phase === "adek_evaluation" &&
          evaluatorComment && (
            <DetailField label="Evaluator comment" value={evaluatorComment} />
          )}

        {assignment.correction_source_phase === "literary_proofreading" &&
          literaryComment && (
            <DetailField
              label="Literary proofreader comment"
              value={literaryComment}
            />
          )}


        {assignment.coordinator_waiting_for_response && (
          <DetailField
            label="Coordinator status"
            value="Waiting for school response"
          />
        )}

        {assignment.coordinator_comment && (
          <DetailField
            label="Coordinator comment"
            value={assignment.coordinator_comment}
          />
        )}
      </dl>

      <p className="muted small" style={{ marginTop: 12 }}>
        After you finish the correction, this artwork will return to the same
        user who requested the correction.
      </p>
    </div>
  );
}

function LiteraryCriteriaCard() {
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Criteria for Literary Proofreading</h3>

      <div className="grid grid-3">
        <div className="submission-text-block">
          <strong>Proofreading and linguistic editing</strong>
          <div dir="rtl">التدقيق اللغوي والتصحيح</div>
        </div>

        <div className="submission-text-block">
          <strong>
            Reviewing content and assessing its suitability for publication
          </strong>
          <div dir="rtl">مراجعة المحتوى وتقييم ملاءمته للنشر</div>
        </div>

        <div className="submission-text-block">
          <strong>
            Ensuring alignment of the submissions with the objectives of the
            initiative
          </strong>
          <div dir="rtl">التأكد من توافق النصوص مع أهداف المبادرة</div>
        </div>
      </div>
    </div>
  );
}

function CoordinatorUpdatedArtworkUpload({
  submission,
  currentPath,
}: {
  submission: any;
  currentPath: string;
}) {
    const [returnPath, setReturnPath] = useState(currentPath);

  useEffect(() => {
    setReturnPath(`${window.location.pathname}${window.location.search}`);
  }, [currentPath]);
  return (
    <div className="card" style={{ boxShadow: "none", marginTop: 16 }}>
      <h4 style={{ marginTop: 0 }}>Updated Artwork Attachment</h4>

      <p className="muted">
        Upload corrected or replacement artwork file(s) only if needed. If you
        upload more than one file, the files will be saved in a Google Drive
        folder named with the submission reference ID.
      </p>

      {submission.updated_artwork_file_url && (
        <p className="muted small">
          Current updated file/folder:{" "}
          <a
            href={submission.updated_artwork_file_url}
            target="_blank"
            rel="noopener noreferrer"
            style={{ textDecoration: "underline" }}
          >
            {submission.updated_artwork_file_name ?? "Open Updated File"}
          </a>
        </p>
      )}

      <form
        action="/api/submissions/updated-artwork"
        method="post"
        encType="multipart/form-data"
        className="grid"
        data-no-global-loading="true"
      >
        <input type="hidden" name="submission_id" value={submission.id} />
        <input type="hidden" name="redirect_to" value={returnPath} />

        <label>
          <span className="small">Updated artwork file(s)</span>
          <input
            className="input"
            type="file"
            name="updated_artwork_file"
            multiple
            accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.ppt,.pptx"
          />
        </label>

        <div className="actions">
          <button className="btn secondary" type="submit">
            Upload Updated Artwork
          </button>
        </div>
      </form>
    </div>
  );
}

export function WorkspaceClient({
  phase,
  role,
  assignments,
  currentPath,
  proofreaderType,
  initialHasNextPage = false,
  initialPage = 1,
  pageSize = 50,
  totalResults,
}: {
  phase: WorkflowPhase;
  role: Role;
  assignments: Assignment[];
  currentPath: string;
  proofreaderType?: ProofreaderType | null;
  initialHasNextPage?: boolean;
  initialPage?: number;
  pageSize?: number;
  totalResults?: number;
}) {
  const [visibleAssignments, setVisibleAssignments] = useState<Assignment[]>(assignments);
  const [selectedId, setSelectedId] = useState<string | null>(
    assignments[0]?.id ?? null
  );
  const workspaceMainRef = useRef<HTMLElement | null>(null);
  const completionBannerRef = useRef<HTMLDivElement | null>(null);

  const [adekFileQualityClear, setAdekFileQualityClear] = useState("yes");
  const [culturalAuthenticity, setCulturalAuthenticity] = useState("yes");
  const [artisticExcellence, setArtisticExcellence] = useState("yes");
  const [ethicalAppropriateness, setEthicalAppropriateness] = useState("yes");
  const [artisticRating, setArtisticRating] = useState("good");
  const [managementArtisticRating, setManagementArtisticRating] =
    useState("good");
  const [artisticQualityCreativityScore, setArtisticQualityCreativityScore] =
    useState(0);
  const [initiativeRelationScore, setInitiativeRelationScore] = useState(0);
  const [ageAppropriatenessScore, setAgeAppropriatenessScore] = useState(0);
  const [generalProofreaderDecision, setGeneralProofreaderDecision] =
    useState("ready");
  const [literaryPublicationSuitable, setLiteraryPublicationSuitable] =
    useState("yes");
  const [returnPath, setReturnPath] = useState(currentPath);
  const [isSubmittingTask, setIsSubmittingTask] = useState(false);
  const [taskError, setTaskError] = useState<string | null>(null);
  const [taskNotice, setTaskNotice] = useState<string | null>(null);
  const [loadedPage, setLoadedPage] = useState(initialPage);
  const [hasNextPage, setHasNextPage] = useState(initialHasNextPage);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    setReturnPath(`${window.location.pathname}${window.location.search}`);
  }, [currentPath]);

  useEffect(() => {
    setVisibleAssignments(assignments);
    setLoadedPage(initialPage);
    setHasNextPage(initialHasNextPage);
    setLoadMoreError(null);
  }, [assignments, initialHasNextPage, initialPage]);

  const selectedAssignment = useMemo(
    () =>
      visibleAssignments.find((assignment) => assignment.id === selectedId) ??
      visibleAssignments[0] ??
      null,
    [visibleAssignments, selectedId]
  );

  const selectedSubmission = selectedAssignment?.submissions ?? null;
  const derived = selectedSubmission ? getDerivedFields(selectedSubmission) : null;
  const selectedIsLiteraryExpression = isLiteraryExpressionsSubmission(selectedSubmission);
  const selectedWorkflowStatus = String(selectedSubmission?.workflow_status ?? "");
  const selectedAssignmentStatus = String(selectedAssignment?.status ?? "");
  const isWorkflowFinal = ["completed", "disqualified"].includes(selectedWorkflowStatus);
  const isAssignmentActionable =
    Boolean(selectedAssignment) &&
    ["assigned", "in_progress"].includes(selectedAssignmentStatus) &&
    !isWorkflowFinal;
  const nonActionableReason = isWorkflowFinal
    ? "This artwork workflow is already final. No further action is available."
    : selectedAssignmentStatus === "returned_for_correction"
      ? "This artwork was sent for correction and is waiting for the Coordinator. No further action is available until it is returned."
      : selectedAssignmentStatus === "sent_for_review"
        ? "This artwork was sent for review. No further action is available from this workspace."
        : ["completed", "cancelled"].includes(selectedAssignmentStatus)
          ? "This task is already closed. No further action is available."
          : null;

  useEffect(() => {
    if (!visibleAssignments.length) {
      setSelectedId(null);
      return;
    }

    if (
      !selectedId ||
      !visibleAssignments.some((assignment) => assignment.id === selectedId)
    ) {
      setSelectedId(visibleAssignments[0].id);
    }
  }, [visibleAssignments, selectedId]);

  useEffect(() => {
    if (!selectedSubmission) return;

    setAdekFileQualityClear(
      selectedSubmission.evaluator_file_quality_clear === false ? "no" : "yes"
    );

    setCulturalAuthenticity("yes");
    setArtisticExcellence("yes");
    setEthicalAppropriateness("yes");

    setArtisticRating(selectedSubmission.artistic_rating ?? "good");

    setManagementArtisticRating(
      selectedSubmission.management_artistic_rating ??
        selectedSubmission.artistic_rating ??
        "good"
    );

    setGeneralProofreaderDecision("ready");

    setLiteraryPublicationSuitable(
      selectedSubmission.literary_publication_suitable === false ? "no" : "yes"
    );

    setArtisticQualityCreativityScore(
      integerOrDefault(selectedSubmission.artistic_quality_creativity_score, 0)
    );
    setInitiativeRelationScore(
      integerOrDefault(selectedSubmission.initiative_relation_score, 0)
    );
    setAgeAppropriatenessScore(
      integerOrDefault(selectedSubmission.age_appropriateness_score, 0)
    );
  }, [selectedSubmission?.id]);

  useEffect(() => {
    setTaskError(null);
    setIsSubmittingTask(false);
  }, [selectedAssignment?.id]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const url = new URL(window.location.href);
    const workError = url.searchParams.get("work_error");

    if (!workError) return;

    setTaskError(workError);
    url.searchParams.delete("work_error");
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  }, []);

  async function loadAssignmentPage({
    page,
    baseAssignments,
    selectFirstNew,
  }: {
    page: number;
    baseAssignments?: Assignment[];
    selectFirstNew?: boolean;
  }) {
    if (typeof window === "undefined") return false;

    setIsLoadingMore(true);
    setLoadMoreError(null);

    try {
      const params = new URLSearchParams(window.location.search);
      params.set("phase", phase);
      params.set("page", String(page));

      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 20000);

      const response = await fetch(`/api/workspace/queue?${params.toString()}`, {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });

      window.clearTimeout(timeoutId);

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(payload?.error ?? "Could not load more artworks.");
      }

      const incomingAssignments = Array.isArray(payload?.assignments)
        ? (payload.assignments as Assignment[])
        : [];
      const base = baseAssignments ?? visibleAssignments;
      const existingIds = new Set(base.map((assignment) => assignment.id));
      const uniqueIncoming = incomingAssignments.filter(
        (assignment) => !existingIds.has(assignment.id)
      );
      const mergedAssignments = [...base, ...uniqueIncoming];

      setVisibleAssignments(mergedAssignments);
      setLoadedPage(Number(payload?.page) || page);
      setHasNextPage(Boolean(payload?.hasNextPage));

      if (selectFirstNew && uniqueIncoming.length > 0) {
        setSelectedId(uniqueIncoming[0].id);
      } else if (!selectedId && mergedAssignments.length > 0) {
        setSelectedId(mergedAssignments[0].id);
      }

      return uniqueIncoming.length > 0;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not load more artworks.";
      setLoadMoreError(message);
      return false;
    } finally {
      setIsLoadingMore(false);
    }
  }

  async function handleLoadMore() {
    await loadAssignmentPage({ page: loadedPage + 1 });
  }

  function scrollToWorkspaceTop() {
    if (typeof window === "undefined") return;

    window.requestAnimationFrame(() => {
      workspaceMainRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });

      completionBannerRef.current?.focus({ preventScroll: true });
    });
  }

  function showCompletionNotice(message: string) {
    setTaskNotice(message);
    scrollToWorkspaceTop();
  }

  function removeSelectedAssignmentFromVisibleList(notice: string) {
    const staleAssignmentId = selectedAssignment?.id;
    const remainingAssignments = staleAssignmentId
      ? visibleAssignments.filter((assignment) => assignment.id !== staleAssignmentId)
      : visibleAssignments;

    setVisibleAssignments(remainingAssignments);
    setSelectedId(remainingAssignments[0]?.id ?? null);
    showCompletionNotice(notice);
  }

  function isStaleTaskErrorMessage(message: string) {
    return /already final|already closed|no longer active|waiting for correction|assigned to another user/i.test(
      message,
    );
  }

  async function handleTaskSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!isAssignmentActionable) {
      setTaskError(
        nonActionableReason ??
          "This task is not available for action. Please refresh the workspace."
      );
      return;
    }

    const form = event.currentTarget;
    const formData = new FormData(form);

    setIsSubmittingTask(true);
    setTaskError(null);
    setTaskNotice(null);

    try {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 60000);

      const response = await fetch(form.action, {
        method: "POST",
        body: formData,
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });

      window.clearTimeout(timeoutId);

      const contentType = response.headers.get("content-type") ?? "";
      const payload = contentType.includes("application/json")
        ? await response.json().catch(() => null)
        : null;

      if (!response.ok) {
        const message =
          payload?.error ??
          "This action could not be completed. Please refresh and try again.";

        if (isStaleTaskErrorMessage(message)) {
          removeSelectedAssignmentFromVisibleList(
            `${message} The stale task was removed from the visible queue.`,
          );
          return;
        }

        throw new Error(message);
      }

      const completedAssignmentId = selectedAssignment?.id;
      const remainingAssignments = completedAssignmentId
        ? visibleAssignments.filter(
            (assignment) => assignment.id !== completedAssignmentId
          )
        : visibleAssignments;

      if (remainingAssignments.length > 0) {
        const nextReferenceId = remainingAssignments[0]?.submissions?.reference_id;
        const nextArtworkMessage = nextReferenceId
          ? `Done. The next artwork is now loaded: ${nextReferenceId}.`
          : "Done. The next artwork is now loaded.";

        setVisibleAssignments(remainingAssignments);
        setSelectedId(remainingAssignments[0].id);
        showCompletionNotice(nextArtworkMessage);
        return;
      }

      if (hasNextPage) {
        setVisibleAssignments([]);
        setSelectedId(null);
        showCompletionNotice(
          payload?.message ??
            `Done. Press Load ${pageSize} more artworks to continue.`
        );
        return;
      }

      setVisibleAssignments([]);
      setSelectedId(null);
      showCompletionNotice(payload?.message ?? "Done. No more loaded artworks remain.");
      return;
    } catch (error) {
      setTaskError(
        error instanceof DOMException && error.name === "AbortError"
          ? "The task was submitted, but the server took too long to respond. Refresh once to confirm whether it was saved before submitting again."
          : error instanceof Error
            ? error.message
            : "This action could not be completed. Please refresh and try again."
      );
      scrollToWorkspaceTop();
    } finally {
      setIsSubmittingTask(false);
    }
  }

  const liveAdekDecision = calculateAdekDecisionLabel(
    culturalAuthenticity,
    artisticExcellence,
    ethicalAppropriateness
  );

  const liveArtisticRubricTotal = calculateArtisticRubricTotal({
    artisticQualityCreativity: artisticQualityCreativityScore,
    initiativeRelation: initiativeRelationScore,
    ageAppropriateness: ageAppropriatenessScore,
  });
  const liveFinalArtisticRating = finalArtisticRatingFromScore(
    liveArtisticRubricTotal
  );
  const liveArtisticRatingBadge = calculateArtisticRatingLabel(
    liveFinalArtisticRating
  );

  const isLimitedSubmissionDetailsView =
    phase === "adek_evaluation" ||
    phase === "proofreading" ||
    phase === "literary_proofreading";

  const shouldShowSchoolNameInLimitedView = phase === "adek_evaluation";

  return (
    <div className="workspace-shell original-workspace-layout">
      <aside className="workspace-sidebar">
        <div className="workspace-sidebar-header">
          <h2>Assigned Artworks</h2>
          <p className="muted small">
            Showing {visibleAssignments.length}
            {typeof totalResults === "number" ? ` of ${totalResults}` : ""} artwork
            {visibleAssignments.length === 1 ? "" : "s"} in this view.
          </p>
        </div>

        <div className="workspace-list">
          {visibleAssignments.map((assignment, index) => {
            const submission = assignment.submissions;
            const fields = submission ? getDerivedFields(submission) : null;
            const isSelected = assignment.id === selectedAssignment?.id;

            return (
              <button
                type="button"
                key={assignment.id}
                className={`workspace-list-item ${isSelected ? "selected" : ""}`}
                onClick={() => setSelectedId(assignment.id)}
              >
                <strong>
                  {index + 1}.{" "}
                  {fields?.artworkName ?? submission?.reference_id ?? "Unknown"}
                </strong>

                {(!isLimitedSubmissionDetailsView ||
                  shouldShowSchoolNameInLimitedView) && (
                  <span>{submission?.institution_name ?? "Unknown school"}</span>
                )}

                {isLimitedSubmissionDetailsView && (
                  <span>
                    {submission?.art_pathway_name_en ?? "Unknown pathway"} ·{" "}
                    {normalizeGrade(submission?.participating_students_grades) ||
                      "Grade unavailable"}
                  </span>
                )}

                {assignment.correction_source_phase && (
                  <span>
                    From:{" "}
                    {getCorrectionSourceLabel(assignment.correction_source_phase)}
                  </span>
                )}

                <span className={statusClassName(assignment.status)}>
                  {assignment.status}
                </span>

                {assignment.coordinator_waiting_for_response && (
                  <span className="pill pill-warning">Waiting for response</span>
                )}
              </button>
            );
          })}

          {visibleAssignments.length === 0 && (
            <div className="workspace-empty">
              No artworks match the selected filters.
            </div>
          )}

          {loadMoreError && (
            <div className="workspace-empty" style={{ color: "#9b2f2f" }}>
              {loadMoreError}
            </div>
          )}

          {hasNextPage && (
            <div className="workspace-empty">
              <button
                className="btn secondary"
                type="button"
                onClick={handleLoadMore}
                disabled={isLoadingMore}
              >
                {isLoadingMore ? "Loading..." : `Load ${pageSize} more artworks`}
              </button>
            </div>
          )}
        </div>
      </aside>

      <section className="workspace-main" ref={workspaceMainRef}>
        {taskNotice && (
          <div
            ref={completionBannerRef}
            className="card"
            role="status"
            aria-live="polite"
            tabIndex={-1}
            style={{
              marginBottom: 16,
              border: "1px solid rgba(0, 73, 73, 0.28)",
              background: "#f0fbf8",
              boxShadow: "0 10px 30px rgba(0, 73, 73, 0.08)",
            }}
          >
            <strong>Done</strong>
            <p className="muted small" style={{ marginBottom: 0 }}>
              {taskNotice}
            </p>
          </div>
        )}

        {!selectedAssignment || !selectedSubmission || !derived ? (
          <div className="card">
            <h2>No artwork selected</h2>
            <p className="muted">
              Select an artwork from the left sidebar to begin.
            </p>
          </div>
        ) : (
          <>
            <div className="workspace-detail-stack">
              {phase === "literary_proofreading" && <LiteraryCriteriaCard />}

              <div className="card">
                <div className="table-title-row">
                  <div>
                    <h2 style={{ marginTop: 0 }}>{derived.artworkName}</h2>

                    {!isLimitedSubmissionDetailsView && (
                      <p className="muted small">
                        Reference ID: {selectedSubmission.reference_id}
                      </p>
                    )}

                    <div className="actions">
                      <span className={statusClassName(selectedSubmission.workflow_status)}>
                        {labelWorkflowStatus(selectedSubmission.workflow_status)}
                      </span>

                      <span className="pill pill-info">{labelPhase(phase)}</span>

                      <span className={statusClassName(selectedAssignment.status)}>
                        Assignment: {selectedAssignment.status}
                      </span>
                    </div>
                  </div>
                </div>

                <dl className="detail-grid" style={{ marginTop: 18 }}>
                  {isLimitedSubmissionDetailsView ? (
                    <>
                      {shouldShowSchoolNameInLimitedView && (
                        <DetailField
                          label="School"
                          value={selectedSubmission.institution_name}
                        />
                      )}

                      <DetailField
                        label="Pathway"
                        value={selectedSubmission.art_pathway_name_en}
                      />

                      <DetailField
                        label="Students Grades"
                        value={normalizeGrade(
                          selectedSubmission.participating_students_grades
                        )}
                      />
                    </>
                  ) : (
                    <>
                      <DetailField
                        label="Reference ID"
                        value={selectedSubmission.reference_id}
                      />
                      <DetailField
                        label="Registration ID"
                        value={selectedSubmission.registration_id}
                      />
                      <DetailField
                        label="Registration Status"
                        value={selectedSubmission.registration_status}
                      />
                      <DetailField
                        label="Submission Date"
                        value={
                          selectedSubmission.submission_date_value ??
                          selectedSubmission.submission_date
                        }
                      />
                      <DetailField
                        label="School"
                        value={selectedSubmission.institution_name}
                      />
                      <DetailField
                        label="School Type"
                        value={selectedSubmission.institution_type}
                      />
                      <DetailField
                        label="Group Name"
                        value={selectedSubmission.group_name}
                      />
                      <DetailField
                        label="Region"
                        value={selectedSubmission.school_region}
                      />
                      <DetailField
                        label="Pathway"
                        value={selectedSubmission.art_pathway_name_en}
                      />
                      <DetailField
                        label="Arabic Pathway"
                        value={derived.arabicPathway}
                      />
                      <DetailField
                        label="Subpathway"
                        value={selectedSubmission.art_sub_pathway_name_en}
                      />
                      <DetailField
                        label="Arabic Subpathway"
                        value={derived.arabicSubpathway}
                      />
                      <DetailField
                        label="Students ESIS"
                        value={
                          selectedSubmission.participating_students_esis_numbers
                        }
                      />
                      <DetailField
                        label="Students Names"
                        value={derived.studentNames}
                      />
                      <DetailField
                        label="Students Grades"
                        value={normalizeGrade(
                          selectedSubmission.participating_students_grades
                        )}
                      />
                      <DetailField
                        label="Genders"
                        value={selectedSubmission.participating_students_genders}
                      />
                      <DetailField
                        label="Nationalities"
                        value={
                          selectedSubmission.participating_students_nationalities
                        }
                      />
                    </>
                  )}

                  {!isLimitedSubmissionDetailsView &&
                    selectedSubmission.artistic_rating && (
                      <DetailField
                        label="ADEK Artistic Rating"
                        value={
                          artisticRatingLabels[
                            selectedSubmission.artistic_rating
                          ] ?? selectedSubmission.artistic_rating
                        }
                      />
                    )}

                  {!isLimitedSubmissionDetailsView &&
                    selectedSubmission.management_artistic_rating && (
                      <DetailField
                        label="Management Artistic Rating"
                        value={
                          artisticRatingLabels[
                            selectedSubmission.management_artistic_rating
                          ] ?? selectedSubmission.management_artistic_rating
                        }
                      />
                    )}

                  {!isLimitedSubmissionDetailsView &&
                    selectedSubmission.categorized_pathway && (
                      <DetailField
                        label="Categorized Pathway"
                        value={selectedSubmission.categorized_pathway}
                      />
                    )}

                  {!isLimitedSubmissionDetailsView &&
                    selectedSubmission.artistic_ranking && (
                      <DetailField
                        label="Artistic Grading"
                        value={selectedSubmission.artistic_ranking}
                      />
                    )}

                  {!isLimitedSubmissionDetailsView &&
                    selectedSubmission.literary_subcategory && (
                      <DetailField
                        label="Literary Subcategory"
                        value={formatLiterarySubcategoryLabel(selectedSubmission.literary_subcategory)}
                      />
                    )}

                  {!isLimitedSubmissionDetailsView &&
                    selectedSubmission.literary_language && (
                      <DetailField
                        label="Literary Language"
                        value={formatLiteraryLanguageLabel(selectedSubmission.literary_language)}
                      />
                    )}

                  {selectedAssignment.correction_source_phase && (
                    <DetailField
                      label="Correction requested from"
                      value={getCorrectionSourceLabel(
                        selectedAssignment.correction_source_phase
                      )}
                    />
                  )}

                  {selectedAssignment.correction_reason && (
                    <DetailField
                      label="Correction Reason"
                      value={
                        correctionReasonLabels[
                          selectedAssignment.correction_reason
                        ] ?? selectedAssignment.correction_reason
                      }
                    />
                  )}
                </dl>
              </div>

              {phase === "coordinator_check" && (
                <CorrectionSourceCard
                  assignment={selectedAssignment}
                  submission={selectedSubmission}
                />
              )}

              {phase === "final_review" && (
                <ReviewerOriginalUpdatedComparison
                  submission={selectedSubmission}
                  derived={derived}
                />
              )}

              {phase !== "adek_evaluation" && (
                <div className="card">
                  <h3>Artwork Text and Narrative</h3>

                  <div className="grid grid-2">
                    <TextBlock
                      label="English Title"
                      value={derived.englishTitle}
                    />
                    <TextBlock
                      label="Arabic Title"
                      value={derived.arabicTitle}
                    />
                    <TextBlock
                      label="English Description"
                      value={derived.englishDescription}
                    />
                    <TextBlock
                      label="Arabic Description"
                      value={derived.arabicDescription}
                    />

                    <TextBlock
                      label="Did anyone or anything influence your idea, such as family, an artist, or a place?"
                      value={derived.influence}
                    />

                    <TextBlock
                      label="What was the most enjoyable part of creating your work?"
                      value={derived.enjoyable}
                    />

                    <TextBlock
                      label="What elements did you focus on in your artwork, and why?"
                      value={derived.elements}
                    />
                  </div>
                </div>
              )}
            </div>

            <form
              key={`${selectedAssignment.id}-${selectedSubmission.id}`}
              className="card workspace-task-action-box"
              action="/api/work/complete"
              method="post"
              data-no-global-loading="true"
              onSubmit={handleTaskSubmit}
            >
              <input type="hidden" name="assignment_id" value={selectedAssignment.id} />
              <input type="hidden" name="submission_id" value={selectedSubmission.id} />
              <input type="hidden" name="phase" value={phase} />
              <input type="hidden" name="redirect_to" value={returnPath} />
              <input
                type="hidden"
                name="proofreader_type"
                value={proofreaderType ?? ""}
              />

              <div className="task-action-header">
                <div>
                  <h3 style={{ marginTop: 0 }}>Task Action</h3>

                  {phase === "adek_evaluation" && (
                    <p className="muted small" style={{ marginBottom: 0 }}>
                      First confirm whether the submitted file is clear enough to
                      evaluate. If it is clear, the rubric will appear and the
                      decision will be calculated automatically.
                    </p>
                  )}

                  {phase === "literary_proofreading" && (
                    <p className="muted small" style={{ marginBottom: 0 }}>
                      First confirm whether the artwork is aligned with the
                      initiative and suitable for publication.
                    </p>
                  )}

                  {phase === "categorization" && (
                    <p className="muted small" style={{ marginBottom: 0 }}>
                      Select the final correct pathway for this reviewed artwork,
                      then click done. This role cannot disqualify or send to correction.
                    </p>
                  )}

                  {phase === "artistic_ranking" && (
                    <p className="muted small" style={{ marginBottom: 0 }}>
                      The final artistic rating is calculated automatically from the total score.
                    </p>
                  )}

                  {phase === "literary_subcategorization" && (
                    <p className="muted small" style={{ marginBottom: 0 }}>
                      Select one literary subcategory for this already graded Literary Expressions submission.
                    </p>
                  )}
                </div>

                {phase === "adek_evaluation" && adekFileQualityClear === "yes" && (
                  <div className={`decision-badge ${liveAdekDecision.className}`}>
                    <span>Decision</span>
                    <strong>{liveAdekDecision.label}</strong>
                  </div>
                )}

                {phase === "artistic_ranking" && (
                  <div className={`decision-badge ${liveArtisticRatingBadge.className}`}>
                    <span>Calculated Final Artistic Rating</span>
                    <strong>{liveArtisticRatingBadge.label}</strong>
                    <small>{liveArtisticRubricTotal} / 100 weighted total</small>
                  </div>
                )}
              </div>

              <SourceButtons submission={selectedSubmission} />

              {taskError && (
                <div
                  className="card"
                  style={{
                    marginTop: 16,
                    boxShadow: "none",
                    border: "1px solid rgba(155, 47, 47, 0.35)",
                    background: "#fff1f1",
                  }}
                >
                  <strong>Action not available</strong>
                  <p className="muted small" style={{ marginBottom: 0 }}>{taskError}</p>
                </div>
              )}

              {!isAssignmentActionable && nonActionableReason && (
                <div
                  className="card"
                  style={{
                    marginTop: 16,
                    boxShadow: "none",
                    border: "1px solid rgba(0, 73, 73, 0.18)",
                  }}
                >
                  <strong>Task closed</strong>
                  <p className="muted small" style={{ marginBottom: 0 }}>{nonActionableReason}</p>
                </div>
              )}

              {isAssignmentActionable && phase === "adek_evaluation" && (
                <>
                  <div className="card" style={{ marginTop: 16, boxShadow: "none" }}>
                    <h4 style={{ marginTop: 0 }}>Artwork File Quality Check</h4>

                    <label>
                      <span className="small">
                        <strong>
                          Can this artwork be evaluated based on the quality and
                          clarity of the submitted image, video, or audio file?
                        </strong>
                        <br />
                        هل يمكن تقييم العمل الفني بناءً على جودة ووضوح ملف الصورة
                        أو الفيديو أو الصوت المرفق؟
                      </span>

                      <select
                        className="input"
                        name="adek_file_quality_clear"
                        value={adekFileQualityClear}
                        onChange={(event) =>
                          setAdekFileQualityClear(event.target.value)
                        }
                        style={{ marginTop: 8 }}
                      >
                        <option value="yes">نعم / Yes</option>
                        <option value="no">لا / No</option>
                      </select>
                    </label>

                    {adekFileQualityClear === "no" && (
                      <p className="muted small" style={{ marginTop: 12 }}>
                        The evaluation rubric will not be shown. This artwork will
                        be sent to the Coordinator for correction, then returned to
                        you for evaluation.
                      </p>
                    )}
                  </div>

                  {adekFileQualityClear === "yes" && (
                    <>
                      <div className="grid grid-3" style={{ marginTop: 18 }}>
                        <label>
                          <span className="small">
                            <strong>أ. الأصالة الثقافية</strong>
                            <br />
                            Cultural Authenticity
                          </span>

                          <select
                            className="input"
                            name="cultural_authenticity"
                            value={culturalAuthenticity}
                            onChange={(event) =>
                              setCulturalAuthenticity(event.target.value)
                            }
                          >
                            <option value="yes">نعم / Yes</option>
                            <option value="no">لا / No</option>
                          </select>
                        </label>

                        <label>
                          <span className="small">
                            <strong>
                              ب. التميز الفني / الجودة والارتباط بالموضوع
                            </strong>
                            <br />
                            Artistic Excellence / Quality & Relevance
                          </span>

                          <select
                            className="input"
                            name="artistic_excellence"
                            value={artisticExcellence}
                            onChange={(event) =>
                              setArtisticExcellence(event.target.value)
                            }
                          >
                            <option value="yes">نعم / Yes</option>
                            <option value="no">لا / No</option>
                          </select>
                        </label>

                        <label>
                          <span className="small">
                            <strong>ج. الملاءمة الأخلاقية والعامة</strong>
                            <br />
                            Ethical & Public Appropriateness
                          </span>

                          <select
                            className="input"
                            name="ethical_public_appropriateness"
                            value={ethicalAppropriateness}
                            onChange={(event) =>
                              setEthicalAppropriateness(event.target.value)
                            }
                          >
                            <option value="yes">نعم / Yes</option>
                            <option value="no">لا / No</option>
                          </select>
                        </label>
                      </div>

                      <label style={{ display: "block", marginTop: 16 }}>
                        <span className="small">
                          <strong>التقييم الفني</strong>
                          <br />
                          Artistic Rating
                        </span>

                        <select
                          className="input"
                          name="artistic_rating"
                          value={artisticRating}
                          onChange={(event) =>
                            setArtisticRating(event.target.value)
                          }
                        >
                          <option value="weak">ضعيف / Weak</option>
                          <option value="medium">متوسط / Medium</option>
                          <option value="good">جيد / Good</option>
                          <option value="excellent">ممتاز / Excellent</option>
                        </select>
                      </label>

                      <label style={{ display: "block", marginTop: 16 }}>
                        <span className="small">
                          <strong>Evaluator Comment</strong>
                          <br />
                          ملاحظات المحكم
                        </span>

                        <textarea
                          className="input"
                          name="evaluator_comment"
                          rows={5}
                          dir="auto"
                          placeholder="Add any notes or comments about this evaluation..."
                          defaultValue={displayText(
                            selectedSubmission.evaluator_comment,
                            ""
                          )}
                        />
                      </label>
                    </>
                  )}
                </>
              )}

              {isAssignmentActionable && phase === "coordinator_check" && (
                <>
                  <p className="muted small">
                    Revise the title, description, and student narrative fields,
                    then send it back to the same user who requested the correction.
                  </p>

                  <div className="card" style={{ marginTop: 16, boxShadow: "none" }}>
                    <h4 style={{ marginTop: 0 }}>Coordinator Follow-up</h4>

                    <label style={{ display: "block" }}>
                      <span className="small">Coordinator Comment</span>
                      <textarea
                        className="input"
                        name="coordinator_comment"
                        rows={4}
                        dir="auto"
                        placeholder="Add school follow-up notes, response details, or internal coordinator comments..."
                        defaultValue={displayText(
                          selectedAssignment.coordinator_comment,
                          ""
                        )}
                      />
                    </label>

                    <label
                      className="actions"
                      style={{ marginTop: 12, alignItems: "center" }}
                    >
                      <input
                        type="checkbox"
                        name="coordinator_waiting_for_response"
                        value="yes"
                        defaultChecked={Boolean(
                          selectedAssignment.coordinator_waiting_for_response
                        )}
                      />
                      <span>Waiting for school response</span>
                    </label>

                    {selectedAssignment.coordinator_waiting_for_response_at && (
                      <p className="muted small" style={{ marginTop: 8 }}>
                        Waiting since: {displayText(selectedAssignment.coordinator_waiting_for_response_at)}
                      </p>
                    )}

                    <button
                      className="btn secondary"
                      type="submit"
                      name="coordinator_action"
                      value="save_progress"
                      style={{ marginTop: 12 }}
                    >
                      Save Comment / Waiting Status
                    </button>
                  </div>

                  <EditableArtworkText
                    key={`coordinator-edit-${selectedSubmission.id}`}
                    derived={derived}
                  />

                  <CoordinatorUpdatedArtworkUpload
                    submission={selectedSubmission}
                    currentPath={returnPath}
                  />

                  <div
                    style={{
                      marginTop: 18,
                      padding: 16,
                      borderRadius: 16,
                      background: "#fff1f1",
                      border: "1px solid rgba(155, 47, 47, 0.25)",
                    }}
                  >
                    <strong>Coordinator Disqualification</strong>

                    <p className="muted small" style={{ marginTop: 8 }}>
                      Use only if the correction cannot be completed.
                    </p>

                    <div className="actions" style={{ marginTop: 12 }}>
                      <button
                        className="btn secondary"
                        type="submit"
                        name="coordinator_action"
                        value="disqualify_no_school_response"
                      >
                        Disqualify: No response from school
                      </button>

                      <button
                        className="btn secondary"
                        type="submit"
                        name="coordinator_action"
                        value="disqualify_incomplete_faulty"
                      >
                        Disqualify: New submission remains incomplete/faulty
                      </button>
                    </div>
                  </div>
                </>
              )}

              {isAssignmentActionable && phase === "proofreading" && (
                <>
                  <EditableArtworkText
                    key={`proofreader-edit-${selectedSubmission.id}`}
                    derived={derived}
                  />

                  <label style={{ display: "block", marginTop: 12 }}>
                    <span className="small">Decision</span>

                    <select
                      className="input"
                      name="general_proofreader_decision"
                      value={generalProofreaderDecision}
                      onChange={(event) =>
                        setGeneralProofreaderDecision(event.target.value)
                      }
                    >
                      <option value="ready">Ready for Next Stage</option>
                      <option value="needs_correction">Needs Correction</option>
                    </select>
                  </label>

                  {generalProofreaderDecision === "needs_correction" && (
                    <label style={{ display: "block", marginTop: 12 }}>
                      <span className="small">Correction Reason</span>

                      <select className="input" name="correction_reason">
                        <option value="artwork_mismatch">Artwork Mismatch</option>
                        <option value="incomplete_narrative">
                          Incomplete Narrative
                        </option>
                        <option value="inappropriate_flagged_content">
                          Inappropriate / Flagged Content
                        </option>
                      </select>
                    </label>
                  )}
                </>
              )}

              {isAssignmentActionable && phase === "literary_proofreading" && (
                <>
                  <div className="card" style={{ marginTop: 16, boxShadow: "none" }}>
                    <h4 style={{ marginTop: 0 }}>Literary Proofreading Decision</h4>
                    <p className="muted small" style={{ marginBottom: 0 }}>
                      Use <strong>Mark Done</strong> when the literary content is ready,
                      <strong> Send for Correction</strong> when the Coordinator needs to correct/update it,
                      or <strong>Disqualify Artwork</strong> when it is not suitable for publication.
                    </p>
                    <input type="hidden" name="literary_publication_suitable" value="yes" />
                  </div>

                  <label style={{ display: "block", marginTop: 12 }}>
                    <span className="small">Literary Proofreader Comment</span>

                    <textarea
                      key={`literary-comment-${selectedSubmission.id}`}
                      name="literary_proofreader_comment"
                      rows={5}
                      dir="auto"
                      placeholder="Write any comments for the Coordinator, Management, Admin, or later workflow users."
                      defaultValue={displayText(
                        selectedSubmission.literary_proofreader_comment,
                        ""
                      )}
                    />
                  </label>

                  <label style={{ display: "block", marginTop: 12 }}>
                    <span className="small">Updated Content</span>

                    <textarea
                      key={`literary-content-${selectedSubmission.id}`}
                      name="literary_updated_content"
                      rows={10}
                      dir="auto"
                      defaultValue={displayText(
                        selectedSubmission.literary_updated_content,
                        ""
                      )}
                    />
                  </label>
                </>
              )}

              {isAssignmentActionable && phase === "management_review" && (
                <>
                  {selectedIsLiteraryExpression ? (
                    <div className="card" style={{ marginTop: 16, boxShadow: "none" }}>
                    </div>
                  ) : (
                    <label>
                      <span className="small">Management Decision</span>

                      <select className="input" name="management_decision">
                        <option value="approved">Approve</option>
                        <option value="disqualified">Disqualify</option>
                      </select>
                    </label>
                  )}

                  <label style={{ display: "block", marginTop: 12 }}>
                    <span className="small">
                      <strong>التقييم الفني</strong>
                      <br />
                      Artistic Rating
                    </span>

                    <select
                      className="input"
                      name="management_artistic_rating"
                      value={managementArtisticRating}
                      onChange={(event) =>
                        setManagementArtisticRating(event.target.value)
                      }
                    >
                      <option value="weak">ضعيف / Weak</option>
                      <option value="medium">متوسط / Medium</option>
                      <option value="good">جيد / Good</option>
                      <option value="excellent">ممتاز / Excellent</option>
                    </select>
                  </label>

                  <label style={{ display: "block", marginTop: 12 }}>
                    <span className="small">Management Comment</span>

                    <textarea
                      className="input"
                      name="management_comment"
                      rows={5}
                      dir="auto"
                      placeholder="Add Management notes, pending reason, or final decision comment..."
                      defaultValue={displayText(
                        selectedAssignment.correction_notes,
                        ""
                      )}
                    />
                  </label>

                  {selectedAssignment.status === "in_progress" &&
                    selectedAssignment.decision === "pending" && (
                      <p className="muted small" style={{ marginTop: 10 }}>
                        This task is currently saved as pending. You can update
                        the comment, approve/disqualify it, or save it as pending
                        again.
                      </p>
                    )}
                </>
              )}

              {isAssignmentActionable && phase === "categorization" && (
                <div className="card" style={{ marginTop: 16, boxShadow: "none" }}>
                  <h4 style={{ marginTop: 0 }}>Categorization</h4>
                  <p className="muted small">
                    Choose the correct final pathway for this artwork based on the
                    latest reviewed title, description, narrative, and attachment.
                  </p>

                  <label style={{ display: "block", marginTop: 12 }}>
                    <span className="small">Correct Pathway</span>
                    <select
                      className="input"
                      name="categorized_pathway"
                      defaultValue={defaultCategorizedPathway(selectedSubmission)}
                      required
                    >
                      <option value="" disabled>
                        Select pathway
                      </option>
                      {categorizationPathways.map((pathway) => (
                        <option key={pathway} value={pathway}>
                          {pathway}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              )}

              {isAssignmentActionable && phase === "artistic_ranking" && (
                <div className="card" style={{ marginTop: 16, boxShadow: "none" }}>
                  <h4 style={{ marginTop: 0 }}>Artistic Grading Rubric</h4>
                  <p className="muted small">
                    Enter a score out of 100 for each criterion. The system applies the
                    rubric weights automatically to calculate the final total and artistic rating.
                  </p>

                  <div className="grid grid-3" style={{ marginTop: 12, alignItems: "end" }}>
                    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <span className="small" style={{ minHeight: 44 }}>
                        Artistic Quality & Creativity / الجودة الفنية والإبداع
                        <br />
                        <strong>Score 0-100 · Weight 50%</strong>
                      </span>
                      <input
                        className="input"
                        type="number"
                        name="artistic_quality_creativity_score"
                        min={0}
                        max={100}
                        step={1}
                        value={artisticQualityCreativityScore}
                        onChange={(event) =>
                          setArtisticQualityCreativityScore(
                            integerOrDefault(event.target.value, 0)
                          )
                        }
                        required
                      />
                    </label>

                    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <span className="small" style={{ minHeight: 44 }}>
                        Relation to the Initiative / الارتباط بموضوع المبادرة
                        <br />
                        <strong>Score 0-100 · Weight 35%</strong>
                      </span>
                      <input
                        className="input"
                        type="number"
                        name="initiative_relation_score"
                        min={0}
                        max={100}
                        step={1}
                        value={initiativeRelationScore}
                        onChange={(event) =>
                          setInitiativeRelationScore(
                            integerOrDefault(event.target.value, 0)
                          )
                        }
                        required
                      />
                    </label>

                    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <span className="small" style={{ minHeight: 44 }}>
                        Age Appropriateness / الملاءمة العمرية
                        <br />
                        <strong>Score 0-100 · Weight 15%</strong>
                      </span>
                      <input
                        className="input"
                        type="number"
                        name="age_appropriateness_score"
                        min={0}
                        max={100}
                        step={1}
                        value={ageAppropriatenessScore}
                        onChange={(event) =>
                          setAgeAppropriatenessScore(
                            integerOrDefault(event.target.value, 0)
                          )
                        }
                        required
                      />
                    </label>
                  </div>
                  <div className="submission-text-block" style={{ marginTop: 12 }}>
                    <strong>Final classification matrix</strong>
                    <div>
                      99-100 Outstanding · 90-98 Excellent · 75-89 Very Good ·
                      41-74 Average · 1-40 Weak
                    </div>
                  </div>
                </div>
              )}

              {isAssignmentActionable && phase === "literary_subcategorization" && (
                <div className="card" style={{ marginTop: 16, boxShadow: "none" }}>
                  <h4 style={{ marginTop: 0 }}>Literary Subcategory</h4>
                  <p className="muted small">
                    Choose the best subcategory and confirm the literary language for this Literary Expressions artwork.
                    This step does not change the rater, score, or final artistic rating.
                  </p>

                  <label style={{ display: "block", marginTop: 12 }}>
                    <span className="small">Literary Language</span>
                    <select
                      className="input"
                      name="literary_language"
                      defaultValue={String(selectedSubmission.literary_language ?? "")}
                      required
                    >
                      <option value="" disabled>
                        Select literary language
                      </option>
                      {LITERARY_LANGUAGE_OPTIONS.map((language) => (
                        <option key={language} value={language}>
                          {LITERARY_LANGUAGE_DISPLAY_LABELS[language]}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label style={{ display: "block", marginTop: 12 }}>
                    <span className="small">Literary Subcategory</span>
                    <select
                      className="input"
                      name="literary_subcategory"
                      defaultValue={String(selectedSubmission.literary_subcategory ?? "")}
                      required
                    >
                      <option value="" disabled>
                        Select literary subcategory
                      </option>
                      {LITERARY_SUBCATEGORY_OPTIONS.map((subcategory) => (
                        <option key={subcategory} value={subcategory}>
                          {LITERARY_SUBCATEGORY_DISPLAY_LABELS[subcategory]}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              )}

              {isAssignmentActionable && phase === "final_review" && (
                <>
                  <EditableArtworkText
                    key={`reviewer-edit-${selectedSubmission.id}`}
                    derived={derived}
                  />

                  <label style={{ display: "block", marginTop: 12 }}>
                    <span className="small">Reviewer Decision</span>

                    <select className="input" name="reviewer_decision">
                      <option value="completed">Mark as Ready for Categorization</option>
                    </select>
                  </label>
                </>
              )}

              {isAssignmentActionable && (
                <div className="actions" style={{ marginTop: 16 }}>
                  {phase === "coordinator_check" ? (
                    <button
                      className="btn"
                      type="submit"
                      name="coordinator_action"
                      value="return_corrected"
                      disabled={isSubmittingTask}
                    >
                      {selectedAssignment.correction_source_phase === "adek_evaluation"
                        ? "Return to Evaluator"
                        : "Return to Proofreader"}
                    </button>
                  ) : phase === "literary_proofreading" ? (
                    <>
                      <button
                        className="btn"
                        type="submit"
                        name="literary_action"
                        value="completed"
                        disabled={isSubmittingTask}
                      >
                        Mark Done
                      </button>

                      <button
                        className="btn secondary"
                        type="submit"
                        name="literary_action"
                        value="needs_correction"
                        disabled={isSubmittingTask}
                      >
                        Send for Correction
                      </button>

                      <button
                        className="btn secondary"
                        type="submit"
                        name="literary_action"
                        value="disqualify"
                        disabled={isSubmittingTask}
                      >
                        Disqualify Artwork
                      </button>
                    </>
                  ) : phase === "management_review" ? (
                    selectedIsLiteraryExpression ? (
                      <>
                        <button
                          className="btn"
                          type="submit"
                          name="management_action"
                          value="send_to_literary_proofreading"
                          disabled={isSubmittingTask}
                        >
                          Send to Literary Proofreading
                        </button>

                        <button
                          className="btn secondary"
                          type="submit"
                          name="management_action"
                          value="pending"
                          disabled={isSubmittingTask}
                        >
                          Save as Pending
                        </button>

                        <button
                          className="btn secondary"
                          type="submit"
                          name="management_action"
                          value="disqualify"
                          disabled={isSubmittingTask}
                        >
                          Disqualify
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          className="btn"
                          type="submit"
                          name="management_action"
                          value="complete"
                          disabled={isSubmittingTask}
                        >
                          Mark Done & Open Next
                        </button>

                        <button
                          className="btn secondary"
                          type="submit"
                          name="management_action"
                          value="pending"
                          disabled={isSubmittingTask}
                        >
                          Save as Pending
                        </button>
                      </>
                    )
                  ) : (
                    <button
                      className="btn"
                      type="submit"
                      name="task_action"
                      value={
                        phase === "adek_evaluation" && adekFileQualityClear === "no"
                          ? "send_correction"
                          : "complete"
                      }
                      disabled={isSubmittingTask}
                    >
                      {phase === "final_review"
                        ? "Mark as Ready for Categorization"
                        : phase === "categorization"
                          ? "Mark Categorization Done"
                          : phase === "artistic_ranking"
                            ? "Submit Rubric & Continue"
                            : phase === "literary_subcategorization"
                              ? "Save Literary Subcategory & Complete"
                              : phase === "adek_evaluation" &&
                                adekFileQualityClear === "no"
                              ? "Send for Correction"
                              : "Mark Done & Open Next"}
                    </button>
                  )}
                </div>
              )}
            </form>

            <TaskHistory history={selectedAssignment.task_history ?? []} />
          </>
        )}
      </section>
    </div>
  );
}

function EditableArtworkText({
  derived,
}: {
  derived: ReturnType<typeof getDerivedFields>;
}) {
  return (
    <div className="grid grid-2">
      <label>
        <span className="small">English Title</span>
        <textarea
          name="artwork_title_en"
          defaultValue={displayText(derived.englishTitle, "")}
          rows={3}
          dir="auto"
        />
      </label>

      <label>
        <span className="small">Arabic Title</span>
        <textarea
          name="artwork_title_ar"
          defaultValue={displayText(derived.arabicTitle, "")}
          rows={3}
          dir="auto"
        />
      </label>

      <label>
        <span className="small">English Description</span>
        <textarea
          name="description_en"
          defaultValue={displayText(derived.englishDescription, "")}
          rows={8}
          dir="auto"
        />
      </label>

      <label>
        <span className="small">Arabic Description</span>
        <textarea
          name="description_ar"
          defaultValue={displayText(derived.arabicDescription, "")}
          rows={8}
          dir="auto"
        />
      </label>

      <label>
        <span className="small">
          Did anyone or anything influence your idea, such as family, an artist,
          or a place?
        </span>
        <textarea
          name="influence_idea_source"
          defaultValue={displayText(derived.influence, "")}
          rows={5}
          dir="auto"
        />
      </label>

      <label>
        <span className="small">
          What was the most enjoyable part of creating your work?
        </span>
        <textarea
          name="most_enjoyable_part"
          defaultValue={displayText(derived.enjoyable, "")}
          rows={5}
          dir="auto"
        />
      </label>

      <label>
        <span className="small">
          What elements did you focus on in your artwork, and why?
        </span>
        <textarea
          name="focused_elements"
          defaultValue={displayText(derived.elements, "")}
          rows={5}
          dir="auto"
        />
      </label>
    </div>
  );
}