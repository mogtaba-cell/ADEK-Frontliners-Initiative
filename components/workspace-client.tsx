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
    "Inappropriate or Flagged Content: The artwork contains elements that require correction or clarification before review can continue.",
  link_access_issue:
    "Link or Access Issue: The artwork file link cannot be opened, is restricted, or is missing.",
  other: "Other: Additional correction is required before the workflow can continue.",
};

function displayText(value: unknown, fallback = "—") {
  if (value === null || value === undefined || String(value).trim() === "") {
    return fallback;
  }

  return String(value);
}

function getDerivedFields(submission: any) {
  const raw = submission?.raw_data ?? {};

  return {
    englishTitle:
      submission?.artwork_title_en ??
      raw.ArtWorkTitleEn ??
      raw.ArtworkTitleEn ??
      raw["Artwork Title En"] ??
      raw.TitleEn ??
      raw["English Title"] ??
      "",
    arabicTitle:
      submission?.artwork_title_ar ??
      raw.ArtWorkTitleAr ??
      raw.ArtworkTitleAr ??
      raw["Artwork Title Ar"] ??
      raw.TitleAr ??
      raw["Arabic Title"] ??
      "",
    englishDescription:
      submission?.description_en ??
      raw.ArtWorkDescrEn ??
      raw.ArtworkDescriptionEn ??
      raw.DescriptionEn ??
      raw.NarrativeEn ??
      raw["English Description"] ??
      "",
    arabicDescription:
      submission?.description_ar ??
      raw.ArtWorkDescrAr ??
      raw.ArtworkDescriptionAr ??
      raw.DescriptionAr ??
      raw.NarrativeAr ??
      raw["Arabic Description"] ??
      "",
    influence:
      submission?.influence_idea_source ??
      raw["Did anyone or anything influence your idea (family, artist, place)?"] ??
      raw["Did anyone or anything influence your idea"] ??
      "",
    enjoyable:
      submission?.most_enjoyable_part ??
      raw["What was the most enjoyable part of creating your work?"] ??
      raw["Most enjoyable part"] ??
      "",
    elements:
      submission?.focused_elements ??
      raw["What elements did you focus on, and why?"] ??
      raw["What elements did you focus on"] ??
      "",
    groupName:
      submission?.group_name ??
      raw.GroupName ??
      raw["Group Name"] ??
      raw.group_name ??
      raw.GroupNameEn ??
      "",
  };
}

function getOriginalImportedFields(submission: any) {
  const raw = submission?.raw_data ?? {};

  return {
    englishTitle:
      raw.ArtWorkTitleEn ??
      raw.ArtworkTitleEn ??
      raw["Artwork Title En"] ??
      raw.TitleEn ??
      raw["English Title"] ??
      submission?.artwork_title_en ??
      "",
    arabicTitle:
      raw.ArtWorkTitleAr ??
      raw.ArtworkTitleAr ??
      raw["Artwork Title Ar"] ??
      raw.TitleAr ??
      raw["Arabic Title"] ??
      submission?.artwork_title_ar ??
      "",
    englishDescription:
      raw.ArtWorkDescrEn ??
      raw.ArtworkDescriptionEn ??
      raw.DescriptionEn ??
      raw.NarrativeEn ??
      raw["English Description"] ??
      submission?.description_en ??
      "",
    arabicDescription:
      raw.ArtWorkDescrAr ??
      raw.ArtworkDescriptionAr ??
      raw.DescriptionAr ??
      raw.NarrativeAr ??
      raw["Arabic Description"] ??
      submission?.description_ar ??
      "",
    influence:
      raw["Did anyone or anything influence your idea (family, artist, place)?"] ??
      raw["Did anyone or anything influence your idea"] ??
      submission?.influence_idea_source ??
      "",
    enjoyable:
      raw["What was the most enjoyable part of creating your work?"] ??
      raw["Most enjoyable part"] ??
      submission?.most_enjoyable_part ??
      "",
    elements:
      raw["What elements did you focus on, and why?"] ??
      raw["What elements did you focus on"] ??
      submission?.focused_elements ??
      "",
  };
}

function getTitle(submission: any) {
  const derived = getDerivedFields(submission);

  return (
    derived.englishTitle ||
    derived.arabicTitle ||
    submission?.reference_id ||
    "Untitled submission"
  );
}

function sourceUrl(submission: any) {
  return submission?.art_link || submission?.raw_data?.ArtLink || "";
}

function isLiteraryPathway(submission: any) {
  const combined = `${submission?.art_pathway_name_en ?? ""} ${
    submission?.art_sub_pathway_name_en ?? ""
  } ${submission?.art_pathway_name_ar ?? ""} ${
    submission?.art_sub_pathway_name_ar ?? ""
  }`.toLowerCase();

  return (
    combined.includes("literary") ||
    combined.includes("الأدبية") ||
    combined.includes("ادبية")
  );
}

function isLiteraryArabic(submission: any) {
  return submission?.literary_language === "arabic";
}

function isLiteraryEnglishOrOthers(submission: any) {
  return submission?.literary_language === "english_or_others";
}

function taskOwnerLabel(assignment: Assignment) {
  if (assignment.phase === "proofreading") return "General Proofreader";
  if (assignment.phase === "literary_proofreading") {
    if (assignment.proofreader_type === "literary_arabic") {
      return "Arabic Literary Proofreader";
    }

    if (assignment.proofreader_type === "literary_english_or_others") {
      return "English/Other Literary Proofreader";
    }

    return "Literary Proofreader";
  }

  return labelPhase(assignment.phase);
}

function formatDate(value: unknown) {
  if (!value) return "—";

  const parsed = new Date(String(value));

  if (Number.isNaN(parsed.getTime())) return String(value);

  return parsed.toLocaleString();
}

function TaskHistory({ history }: { history: any[] }) {
  if (!history?.length) {
    return null;
  }

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h3>Task History</h3>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Phase</th>
              <th>Status</th>
              <th>Assigned To</th>
              <th>Completed</th>
              <th>Correction Notes</th>
            </tr>
          </thead>

          <tbody>
            {history.map((item) => (
              <tr key={item.id}>
                <td>{labelPhase(item.phase)}</td>
                <td>{displayText(item.status)}</td>
                <td>{displayText(item.assigned_to_profile?.full_name)}</td>
                <td>{formatDate(item.completed_at)}</td>
                <td>{displayText(item.correction_notes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SourceButtons({ submission }: { submission: any }) {
  const url = sourceUrl(submission);

  if (!url) {
    return (
      <div className="card" style={{ marginTop: 16 }}>
        <p className="muted">No artwork source file link found.</p>
      </div>
    );
  }

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h3>Artwork Source File</h3>

      <p className="muted">
        Open the submitted artwork file in a new tab to review the image, video,
        audio, or document.
      </p>

      <a className="btn" href={url} target="_blank" rel="noopener noreferrer">
        Open Source File
      </a>
    </div>
  );
}

function ArtworkDetails({ submission }: { submission: any }) {
  const derived = getDerivedFields(submission);

  return (
    <div className="card">
      <h2>{getTitle(submission)}</h2>

      <div className="grid grid-2">
        <p>
          <strong>Reference ID</strong>
          <br />
          {displayText(submission?.reference_id)}
        </p>

        <p>
          <strong>Workflow Status</strong>
          <br />
          <span className={statusClassName(submission?.workflow_status)}>
            {labelWorkflowStatus(submission?.workflow_status)}
          </span>
        </p>

        <p>
          <strong>Pathway</strong>
          <br />
          {displayText(submission?.art_pathway_name_en)}
        </p>

        <p>
          <strong>Sub-pathway</strong>
          <br />
          {displayText(submission?.art_sub_pathway_name_en)}
        </p>

        <p>
          <strong>School</strong>
          <br />
          {displayText(submission?.institution_name)}
        </p>

        <p>
          <strong>Region</strong>
          <br />
          {displayText(submission?.school_region)}
        </p>

        <p>
          <strong>Student Names</strong>
          <br />
          {displayText(submission?.participating_students_names)}
        </p>

        <p>
          <strong>Grades</strong>
          <br />
          {displayText(submission?.participating_students_grades)}
        </p>
      </div>

      {derived.groupName && (
        <p>
          <strong>Group Name</strong>
          <br />
          {displayText(derived.groupName)}
        </p>
      )}

      <div className="grid grid-2" style={{ marginTop: 16 }}>
        <div>
          <h3>English Description</h3>
          <p dir="auto">{displayText(derived.englishDescription)}</p>
        </div>

        <div>
          <h3>Arabic Description</h3>
          <p dir="auto">{displayText(derived.arabicDescription)}</p>
        </div>
      </div>

      <div className="grid grid-3" style={{ marginTop: 16 }}>
        <p>
          <strong>Influence</strong>
          <br />
          {displayText(derived.influence)}
        </p>

        <p>
          <strong>Most Enjoyable Part</strong>
          <br />
          {displayText(derived.enjoyable)}
        </p>

        <p>
          <strong>Focused Elements</strong>
          <br />
          {displayText(derived.elements)}
        </p>
      </div>
    </div>
  );
}

function OriginalImportedArtworkDetails({ submission }: { submission: any }) {
  const fields = getOriginalImportedFields(submission);

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h3>Original Imported Artwork Text</h3>

      <p className="muted">
        This is the original text from the uploaded import file before any
        coordinator, proofreader, or reviewer edits.
      </p>

      <div className="grid grid-2">
        <p>
          <strong>English Title</strong>
          <br />
          {displayText(fields.englishTitle)}
        </p>

        <p>
          <strong>Arabic Title</strong>
          <br />
          {displayText(fields.arabicTitle)}
        </p>

        <p>
          <strong>English Description</strong>
          <br />
          {displayText(fields.englishDescription)}
        </p>

        <p>
          <strong>Arabic Description</strong>
          <br />
          {displayText(fields.arabicDescription)}
        </p>

        <p>
          <strong>Influence</strong>
          <br />
          {displayText(fields.influence)}
        </p>

        <p>
          <strong>Most Enjoyable Part</strong>
          <br />
          {displayText(fields.enjoyable)}
        </p>

        <p>
          <strong>Focused Elements</strong>
          <br />
          {displayText(fields.elements)}
        </p>
      </div>
    </div>
  );
}

function LiveAdekDecision({
  fileQualityClear,
  culturalAuthenticity,
  artisticExcellence,
  ethicalAppropriateness,
  artisticRating,
}: {
  fileQualityClear: string;
  culturalAuthenticity: string;
  artisticExcellence: string;
  ethicalAppropriateness: string;
  artisticRating: string;
}) {
  if (fileQualityClear === "no") {
    return {
      decision: "send_correction",
      label: "Send for Correction",
      className: "warning",
    };
  }

  if (
    culturalAuthenticity === "no" ||
    artisticExcellence === "no" ||
    ethicalAppropriateness === "no"
  ) {
    return {
      decision: "disqualified",
      label: "Disqualified",
      className: "danger",
    };
  }

  if (artisticRating === "excellent") {
    return {
      decision: "approved",
      label: "Approved",
      className: "success",
    };
  }

  return {
    decision: "needs_management_review",
    label: "Needs Management Review",
    className: "warning",
  };
}

function ManagementDecisionBadge({
  decision,
}: {
  decision: string;
}) {
  if (decision === "approved") {
    return (
      <div className="decision-badge success">
        <span>Decision</span>
        <strong>Approved</strong>
      </div>
    );
  }

  if (decision === "disqualified") {
    return (
      <div className="decision-badge danger">
        <span>Decision</span>
        <strong>Disqualified</strong>
      </div>
    );
  }

  return (
    <div className="decision-badge warning">
      <span>Decision</span>
      <strong>Pending</strong>
    </div>
  );
}

function CorrectionNotice({ assignment }: { assignment: Assignment }) {
  if (!assignment.correction_reason && !assignment.correction_notes) {
    return null;
  }

  return (
    <div className="card" style={{ marginTop: 16, borderColor: "#d99" }}>
      <h3>Correction Request</h3>

      {assignment.correction_reason && (
        <p>
          <strong>Reason</strong>
          <br />
          {correctionReasonLabels[assignment.correction_reason] ??
            assignment.correction_reason}
        </p>
      )}

      {assignment.correction_notes && (
        <p>
          <strong>Notes</strong>
          <br />
          {assignment.correction_notes}
        </p>
      )}
    </div>
  );
}

function CoordinatorUploadBox({ assignment }: { assignment: Assignment }) {
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h3>Upload Corrected Artwork Link</h3>

      <p className="muted">
        Update the artwork source link after correction, then send the task back
        to the requester.
      </p>

      <form action="/api/work/complete" method="post">
        <input type="hidden" name="assignment_id" value={assignment.id} />
        <input type="hidden" name="task_action" value="return_correction" />

        <label>
          <span className="small">Corrected Artwork Link</span>
          <input className="input" name="art_link" type="url" required />
        </label>

        <label>
          <span className="small">Coordinator Notes</span>
          <textarea
            className="input"
            name="coordinator_notes"
            rows={4}
            placeholder="Describe what was corrected..."
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
    useState("approved");
  const [literaryPublicationSuitable, setLiteraryPublicationSuitable] =
    useState("yes");
  const [literaryManagementDecision, setLiteraryManagementDecision] =
    useState("approved");

  const selectedAssignment = useMemo(
    () => assignments.find((assignment) => assignment.id === selectedId) ?? null,
    [assignments, selectedId]
  );

  const selectedSubmission = selectedAssignment?.submissions ?? null;

  useEffect(() => {
    setAdekFileQualityClear(
      selectedSubmission?.evaluator_file_quality_clear === false ? "no" : "yes"
    );

    setCulturalAuthenticity(
      selectedSubmission?.cultural_authenticity === false ? "no" : "yes"
    );

    setArtisticExcellence(
      selectedSubmission?.artistic_excellence === false ? "no" : "yes"
    );

    setEthicalAppropriateness(
      selectedSubmission?.ethical_public_appropriateness === false
        ? "no"
        : "yes"
    );

    setArtisticRating(selectedSubmission?.artistic_rating ?? "good");
    setManagementArtisticRating(
      selectedSubmission?.management_artistic_rating ?? "good"
    );
    setGeneralProofreaderDecision(
      selectedSubmission?.general_proofreader_decision ?? "approved"
    );
    setLiteraryPublicationSuitable(
      selectedSubmission?.literary_publication_suitable === false ? "no" : "yes"
    );
    setLiteraryManagementDecision(
      selectedSubmission?.literary_management_decision ?? "approved"
    );
  }, [selectedSubmission?.id]);

  const liveAdekDecision = LiveAdekDecision({
    fileQualityClear: adekFileQualityClear,
    culturalAuthenticity,
    artisticExcellence,
    ethicalAppropriateness,
    artisticRating,
  });

  if (!assignments.length) {
    return (
      <div className="grid grid-2">
        <section className="card">
          <h2>No tasks available</h2>
          <p className="muted">
            There are no active {labelPhase(phase)} tasks assigned to you.
          </p>
        </section>
      </div>
    );
  }

  const derived = selectedSubmission ? getDerivedFields(selectedSubmission) : null;
  const selectedIsLiterary = selectedSubmission
    ? isLiteraryPathway(selectedSubmission)
    : false;

  return (
    <div className="grid grid-2 workspace-layout">
      <section className="card">
        <h2>Task List</h2>

        <p className="muted">
          Select a task to review. Tasks are shown with the newest assigned work
          first.
        </p>

        <div className="task-list">
          {assignments.map((assignment) => {
            const submission = assignment.submissions;
            const active = assignment.id === selectedId;

            return (
              <button
                key={assignment.id}
                type="button"
                className={`task-card ${active ? "active" : ""}`}
                onClick={() => setSelectedId(assignment.id)}
              >
                <span className="task-card-title">
                  {getTitle(submission)}
                </span>

                <span className="task-card-meta">
                  {displayText(submission?.reference_id)}
                </span>

                <span className="task-card-meta">
                  {taskOwnerLabel(assignment)}
                </span>

                <span className={statusClassName(submission?.workflow_status)}>
                  {labelWorkflowStatus(submission?.workflow_status)}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section>
        {!selectedAssignment || !selectedSubmission || !derived ? (
          <div className="card">
            <h2>Select a task</h2>
          </div>
        ) : (
          <>
            <ArtworkDetails submission={selectedSubmission} />
            <OriginalImportedArtworkDetails submission={selectedSubmission} />
            <CorrectionNotice assignment={selectedAssignment} />

            {phase === "coordinator_check" && (
              <CoordinatorUploadBox assignment={selectedAssignment} />
            )}

            <form action="/api/work/complete" method="post">
              <input
                type="hidden"
                name="assignment_id"
                value={selectedAssignment.id}
              />

              <div className="card" style={{ marginTop: 16 }}>
                <div className="table-title-row">
                  <div>
                    <h2>{labelPhase(phase)} Action</h2>

                    <p className="muted">
                      Complete the required decision fields for this task.
                    </p>

                    {phase === "adek_evaluation" && (
                      <p className="muted small" style={{ marginBottom: 0 }}>
                        The final evaluator decision will be calculated
                        automatically.
                      </p>
                    )}

                    {phase === "literary_proofreading" && (
                      <p className="muted small" style={{ marginBottom: 0 }}>
                        First confirm whether the artwork is aligned with the
                        initiative and suitable for publication.
                      </p>
                    )}
                  </div>

                  {phase === "adek_evaluation" &&
                    adekFileQualityClear === "yes" && (
                      <div
                        className={`decision-badge ${liveAdekDecision.className}`}
                      >
                        <span>Decision</span>
                        <strong>{liveAdekDecision.label}</strong>
                      </div>
                    )}
                </div>

                <SourceButtons submission={selectedSubmission} />

                {phase === "adek_evaluation" && (
                  <>
                    <div
                      className="card"
                      style={{ marginTop: 16, boxShadow: "none" }}
                    >
                      <label>
                        <span className="small">
                          <strong>
                            Can the artwork be evaluated based on the quality and
                            clarity of the submitted image, video, or audio file?
                          </strong>
                          <br />
                          هل يمكن تقييم العمل الفني بناءً على جودة ووضوح ملف
                          الصورة أو الفيديو أو الصوت المرفق؟
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
                          The evaluation rubric will not be shown. This artwork
                          will be sent to the Coordinator for correction, then
                          returned to you for evaluation.
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
                            <option value="excellent">
                              ممتاز / Excellent
                            </option>
                          </select>
                        </label>
                      </>
                    )}

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

                {phase === "coordinator_check" && (
                  <>
                    <p className="muted small">
                      Revise the title, description, and student narrative
                      fields, then send it back to the same user who requested
                      the correction.
                    </p>

                    <EditableArtworkText derived={derived} />
                  </>
                )}

                {phase === "management_review" && (
                  <>
                    <label>
                      <span className="small">Management Artistic Rating</span>

                      <select
                        className="input"
                        name="management_artistic_rating"
                        value={managementArtisticRating}
                        onChange={(event) =>
                          setManagementArtisticRating(event.target.value)
                        }
                      >
                        <option value="weak">Weak</option>
                        <option value="medium">Medium</option>
                        <option value="good">Good</option>
                        <option value="excellent">Excellent</option>
                      </select>
                    </label>

                    <ManagementDecisionBadge
                      decision={
                        managementArtisticRating === "excellent"
                          ? "approved"
                          : "disqualified"
                      }
                    />

                    <label style={{ display: "block", marginTop: 16 }}>
                      <span className="small">Management Notes</span>

                      <textarea
                        className="input"
                        name="management_notes"
                        rows={5}
                        placeholder="Add management notes..."
                        defaultValue={displayText(
                          selectedSubmission.management_notes,
                          ""
                        )}
                      />
                    </label>
                  </>
                )}

                {phase === "proofreading" && (
                  <>
                    <EditableArtworkText derived={derived} />

                    <label style={{ display: "block", marginTop: 12 }}>
                      <span className="small">General Proofreader Decision</span>

                      <select
                        className="input"
                        name="general_proofreader_decision"
                        value={generalProofreaderDecision}
                        onChange={(event) =>
                          setGeneralProofreaderDecision(event.target.value)
                        }
                      >
                        <option value="approved">Approve</option>
                        <option value="needs_correction">
                          Send for Correction
                        </option>
                      </select>
                    </label>

                    <label style={{ display: "block", marginTop: 12 }}>
                      <span className="small">General Proofreader Notes</span>

                      <textarea
                        className="input"
                        name="general_proofreader_notes"
                        rows={4}
                        defaultValue={displayText(
                          selectedSubmission.general_proofreader_notes,
                          ""
                        )}
                      />
                    </label>
                  </>
                )}

                {phase === "literary_proofreading" && (
                  <>
                    {proofreaderType === "literary_arabic" ||
                    isLiteraryArabic(selectedSubmission) ? (
                      <label style={{ display: "block" }}>
                        <span className="small">
                          Updated Arabic Literary Content
                        </span>

                        <textarea
                          className="input"
                          name="literary_updated_content"
                          rows={10}
                          dir="auto"
                          defaultValue={displayText(
                            selectedSubmission.literary_updated_content ||
                              selectedSubmission.description_ar,
                            ""
                          )}
                        />
                      </label>
                    ) : (
                      <label style={{ display: "block" }}>
                        <span className="small">
                          Updated English/Other Literary Content
                        </span>

                        <textarea
                          className="input"
                          name="literary_updated_content"
                          rows={10}
                          dir="auto"
                          defaultValue={displayText(
                            selectedSubmission.literary_updated_content ||
                              selectedSubmission.description_en,
                            ""
                          )}
                        />
                      </label>
                    )}

                    <label style={{ display: "block", marginTop: 12 }}>
                      <span className="small">
                        Suitable for Publication / Aligned With Initiative
                      </span>

                      <select
                        className="input"
                        name="literary_publication_suitable"
                        value={literaryPublicationSuitable}
                        onChange={(event) =>
                          setLiteraryPublicationSuitable(event.target.value)
                        }
                      >
                        <option value="yes">Yes</option>
                        <option value="no">No</option>
                      </select>
                    </label>

                    <label style={{ display: "block", marginTop: 12 }}>
                      <span className="small">Literary Notes</span>

                      <textarea
                        className="input"
                        name="literary_notes"
                        rows={4}
                        defaultValue={displayText(
                          selectedSubmission.literary_notes,
                          ""
                        )}
                      />
                    </label>
                  </>
                )}

                {phase === "final_review" && (
                  <>
                    <EditableArtworkText derived={derived} />

                    <label style={{ display: "block", marginTop: 12 }}>
                      <span className="small">Reviewer Decision</span>

                      <select className="input" name="reviewer_decision">
                        <option value="completed">Mark as Ready</option>
                      </select>
                    </label>
                  </>
                )}

                {phase === "literary_proofreading" &&
                literaryPublicationSuitable === "no" ? (
                  <div className="card" style={{ marginTop: 16 }}>
                    <h3>Correction Details</h3>

                    <label>
                      <span className="small">Correction Reason</span>

                      <select
                        className="input"
                        name="correction_reason"
                        required
                      >
                        <option value="">Select reason</option>
                        {Object.entries(correctionReasonLabels).map(
                          ([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          )
                        )}
                      </select>
                    </label>

                    <label>
                      <span className="small">Correction Notes</span>

                      <textarea
                        className="input"
                        name="correction_notes"
                        rows={4}
                        required
                      />
                    </label>
                  </div>
                ) : null}

                {phase === "proofreading" &&
                generalProofreaderDecision === "needs_correction" ? (
                  <div className="card" style={{ marginTop: 16 }}>
                    <h3>Correction Details</h3>

                    <label>
                      <span className="small">Correction Reason</span>

                      <select
                        className="input"
                        name="correction_reason"
                        required
                      >
                        <option value="">Select reason</option>
                        {Object.entries(correctionReasonLabels).map(
                          ([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          )
                        )}
                      </select>
                    </label>

                    <label>
                      <span className="small">Correction Notes</span>

                      <textarea
                        className="input"
                        name="correction_notes"
                        rows={4}
                        required
                      />
                    </label>
                  </div>
                ) : null}

                <div className="actions" style={{ marginTop: 16 }}>
                  {phase === "literary_proofreading" &&
                  literaryPublicationSuitable === "no" ? (
                    <button
                      className="btn secondary"
                      type="submit"
                      name="literary_action"
                      value="needs_correction"
                    >
                      Send for Correction
                    </button>
                  ) : phase === "proofreading" &&
                    generalProofreaderDecision === "needs_correction" ? (
                    <button
                      className="btn secondary"
                      type="submit"
                      name="task_action"
                      value="send_correction"
                    >
                      Send for Correction
                    </button>
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