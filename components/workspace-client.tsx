"use client";

import { useEffect, useMemo, useState } from "react";
import type { ProofreaderType, Role, WorkflowPhase } from "@/lib/types";
import { labelPhase, labelWorkflowStatus, statusClassName } from "@/lib/workflow";

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
};

const correctionSourceLabels: Record<string, string> = {
  adek_evaluation: "ADEK Evaluation",
  proofreading: "General Proofreading",
  literary_proofreading: "Literary Proofreading",
  coordinator_check: "Coordinator Correction",
};

const artisticRatingLabels: Record<string, string> = {
  weak: "ضعيف / Weak",
  medium: "متوسط / Medium",
  good: "جيد / Good",
  excellent: "ممتاز / Excellent",
};

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

function getCorrectionSourceLabel(value: string | null | undefined) {
  if (!value) return "Unknown phase";
  return correctionSourceLabels[value] ?? labelPhase(value) ?? value;
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
    <div className="actions" style={{ marginTop: 16 }}>
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

function CorrectionSourceCard({ assignment }: { assignment: Assignment }) {
  if (!assignment.correction_reason && !assignment.correction_source_phase) {
    return null;
  }

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
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Updated Artwork Attachment</h3>

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
      >
        <input type="hidden" name="submission_id" value={submission.id} />
        <input type="hidden" name="redirect_to" value={currentPath} />

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
}: {
  phase: WorkflowPhase;
  role: Role;
  assignments: Assignment[];
  currentPath: string;
  proofreaderType?: ProofreaderType | null;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(
    assignments[0]?.id ?? null
  );

  const [adekFileQualityClear, setAdekFileQualityClear] = useState("yes");
  const [culturalAuthenticity, setCulturalAuthenticity] = useState("yes");
  const [artisticExcellence, setArtisticExcellence] = useState("yes");
  const [ethicalAppropriateness, setEthicalAppropriateness] = useState("yes");
  const [artisticRating, setArtisticRating] = useState("good");
  const [managementArtisticRating, setManagementArtisticRating] =
    useState("good");
  const [generalProofreaderDecision, setGeneralProofreaderDecision] =
    useState("ready");
  const [literaryPublicationSuitable, setLiteraryPublicationSuitable] =
    useState("yes");

  const selectedAssignment = useMemo(
    () =>
      assignments.find((assignment) => assignment.id === selectedId) ??
      assignments[0] ??
      null,
    [assignments, selectedId]
  );

  const selectedSubmission = selectedAssignment?.submissions ?? null;
  const derived = selectedSubmission ? getDerivedFields(selectedSubmission) : null;

  useEffect(() => {
    if (!assignments.length) {
      setSelectedId(null);
      return;
    }

    if (!selectedId || !assignments.some((assignment) => assignment.id === selectedId)) {
      setSelectedId(assignments[0].id);
    }
  }, [assignments, selectedId]);

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
  }, [selectedSubmission?.id]);

  const liveAdekDecision = calculateAdekDecisionLabel(
    culturalAuthenticity,
    artisticExcellence,
    ethicalAppropriateness
  );

  const isAdekEvaluatorView = phase === "adek_evaluation";

  return (
    <div className="workspace-shell">
      <aside className="workspace-sidebar">
        <div className="workspace-sidebar-header">
          <h2>Assigned Artworks</h2>
          <p className="muted small">
            {assignments.length} artwork{assignments.length === 1 ? "" : "s"} in
            this view.
          </p>
        </div>

        <div className="workspace-list">
          {assignments.map((assignment, index) => {
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

                {!isAdekEvaluatorView && (
                  <span>{submission?.institution_name ?? "Unknown school"}</span>
                )}

                {isAdekEvaluatorView && (
                  <span>
                    {submission?.art_pathway_name_en ?? "Unknown pathway"} ·{" "}
                    {normalizeGrade(
                      submission?.participating_students_grades
                    ) || "Grade unavailable"}
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
              </button>
            );
          })}

          {assignments.length === 0 && (
            <div className="workspace-empty">
              No artworks match the selected filters.
            </div>
          )}
        </div>
      </aside>

      <section className="workspace-main">
        {!selectedAssignment || !selectedSubmission || !derived ? (
          <div className="card">
            <h2>No artwork selected</h2>
            <p className="muted">Select an artwork from the left sidebar to begin.</p>
          </div>
        ) : (
          <>
            <div className="card">
              <div className="table-title-row">
                <div>
                  <h2 style={{ marginTop: 0 }}>{derived.artworkName}</h2>

                  {!isAdekEvaluatorView && (
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
                {isAdekEvaluatorView ? (
                  <>
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
                    <DetailField label="School" value={selectedSubmission.institution_name} />
                    <DetailField
                      label="School Type"
                      value={selectedSubmission.institution_type}
                    />
                    <DetailField
                      label="Group Name"
                      value={selectedSubmission.group_name}
                    />
                    <DetailField label="Region" value={selectedSubmission.school_region} />
                    <DetailField
                      label="Pathway"
                      value={selectedSubmission.art_pathway_name_en}
                    />
                    <DetailField label="Arabic Pathway" value={derived.arabicPathway} />
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
                      value={selectedSubmission.participating_students_esis_numbers}
                    />
                    <DetailField label="Students Names" value={derived.studentNames} />
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
                      value={selectedSubmission.participating_students_nationalities}
                    />
                  </>
                )}

                {!isAdekEvaluatorView && selectedSubmission.artistic_rating && (
                  <DetailField
                    label="ADEK Artistic Rating"
                    value={
                      artisticRatingLabels[selectedSubmission.artistic_rating] ??
                      selectedSubmission.artistic_rating
                    }
                  />
                )}

                {!isAdekEvaluatorView &&
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
                      correctionReasonLabels[selectedAssignment.correction_reason] ??
                      selectedAssignment.correction_reason
                    }
                  />
                )}
              </dl>

              <SourceButtons submission={selectedSubmission} />
            </div>

            {phase === "coordinator_check" && (
              <>
                <CorrectionSourceCard assignment={selectedAssignment} />
                <CoordinatorUpdatedArtworkUpload
                  submission={selectedSubmission}
                  currentPath={currentPath}
                />
              </>
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
                  <TextBlock label="English Title" value={derived.englishTitle} />
                  <TextBlock label="Arabic Title" value={derived.arabicTitle} />
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

            <form
              key={`${selectedAssignment.id}-${selectedSubmission.id}`}
              className="card"
              action="/api/work/complete"
              method="post"
            >
              <input type="hidden" name="assignment_id" value={selectedAssignment.id} />
              <input type="hidden" name="submission_id" value={selectedSubmission.id} />
              <input type="hidden" name="phase" value={phase} />
              <input type="hidden" name="redirect_to" value={currentPath} />
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
                </div>

                {phase === "adek_evaluation" && adekFileQualityClear === "yes" && (
                  <div className={`decision-badge ${liveAdekDecision.className}`}>
                    <span>Decision</span>
                    <strong>{liveAdekDecision.label}</strong>
                  </div>
                )}
              </div>

              {phase === "adek_evaluation" && (
                <>
                  <div className="card" style={{ marginTop: 16 }}>
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

                  <SourceButtons submission={selectedSubmission} />
                </>
              )}

              {phase === "coordinator_check" && (
                <>
                  <p className="muted small">
                    Revise the title, description, and student narrative fields,
                    then send it back to the same user who requested the correction.
                  </p>

                  <EditableArtworkText
                    key={`coordinator-edit-${selectedSubmission.id}`}
                    derived={derived}
                  />

                  <SourceButtons submission={selectedSubmission} />

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

              {phase === "proofreading" && (
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

                  <SourceButtons submission={selectedSubmission} />
                </>
              )}

              {phase === "literary_proofreading" && (
                <>
                  <div className="card" style={{ marginTop: 16 }}>
                    <h4 style={{ marginTop: 0 }}>
                      Literary Suitability Check
                    </h4>

                    <label>
                      <span className="small">
                        <strong>
                          Is the artwork aligned with the initiative and suitable
                          for publication?
                        </strong>
                        <br />
                        هل يتوافق العمل الفني مع أهداف المبادرة، وهل هو مناسب
                        للنشر؟
                      </span>

                      <select
                        className="input"
                        name="literary_publication_suitable"
                        value={literaryPublicationSuitable}
                        onChange={(event) =>
                          setLiteraryPublicationSuitable(event.target.value)
                        }
                        style={{ marginTop: 8 }}
                      >
                        <option value="yes">نعم / Yes</option>
                        <option value="no">لا / No</option>
                      </select>
                    </label>

                    {literaryPublicationSuitable === "no" && (
                      <p className="muted small" style={{ marginTop: 12 }}>
                        The content update field will not be shown. This artwork
                        will be sent to Management for final review.
                      </p>
                    )}
                  </div>

                  {literaryPublicationSuitable === "yes" && (
                    <>
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

                      <p className="muted small" style={{ marginTop: 12 }}>
                        Choose Mark Done if the literary content is ready, or Send
                        for Correction if the Coordinator needs to correct/update
                        the submission first.
                      </p>
                    </>
                  )}

                  <SourceButtons submission={selectedSubmission} />
                </>
              )}

              {phase === "management_review" && (
                <>
                  <label>
                    <span className="small">Management Decision</span>

                    <select className="input" name="management_decision">
                      <option value="approved">Approve</option>
                      <option value="disqualified">Disqualify</option>
                    </select>
                  </label>

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

                  <SourceButtons submission={selectedSubmission} />
                </>
              )}

              {phase === "final_review" && (
                <>
                  <EditableArtworkText
                    key={`reviewer-edit-${selectedSubmission.id}`}
                    derived={derived}
                  />

                  <label style={{ display: "block", marginTop: 12 }}>
                    <span className="small">Reviewer Decision</span>

                    <select className="input" name="reviewer_decision">
                      <option value="completed">Mark as Ready</option>
                    </select>
                  </label>

                  <SourceButtons submission={selectedSubmission} />
                </>
              )}

              <div className="actions" style={{ marginTop: 16 }}>
                {phase === "coordinator_check" ? (
                  <button
                    className="btn"
                    type="submit"
                    name="coordinator_action"
                    value="return_corrected"
                  >
                    {selectedAssignment.correction_source_phase ===
                    "adek_evaluation"
                      ? "Return to Evaluator"
                      : "Return to Proofreader"}
                  </button>
                ) : phase === "literary_proofreading" ? (
                  literaryPublicationSuitable === "no" ? (
                    <button
                      className="btn"
                      type="submit"
                      name="literary_action"
                      value="needs_review"
                    >
                      Needs Review
                    </button>
                  ) : (
                    <>
                      <button
                        className="btn"
                        type="submit"
                        name="literary_action"
                        value="completed"
                      >
                        Mark Done
                      </button>

                      <button
                        className="btn secondary"
                        type="submit"
                        name="literary_action"
                        value="needs_correction"
                      >
                        Send for Correction
                      </button>
                    </>
                  )
                ) : (
                  <button
                    className="btn"
                    type="submit"
                    name="task_action"
                    value={
                      phase === "adek_evaluation" &&
                      adekFileQualityClear === "no"
                        ? "send_correction"
                        : "complete"
                    }
                  >
                    {phase === "final_review"
                      ? "Mark as Ready"
                      : phase === "adek_evaluation" &&
                          adekFileQualityClear === "no"
                        ? "Send for Correction"
                        : "Mark Done & Open Next"}
                  </button>
                )}
              </div>
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