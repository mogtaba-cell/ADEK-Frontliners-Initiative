"use client";

import { useMemo, useState } from "react";
import { labelWorkflowStatus } from "@/lib/workflow";

type Submission = Record<string, any>;

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

function fallbackText(
  submission: Submission,
  directValue: unknown,
  rawKeys: string[]
) {
  if (
    directValue !== null &&
    directValue !== undefined &&
    String(directValue).trim() !== ""
  ) {
    return directValue;
  }

  return rawText(submission.raw_data, rawKeys);
}

function DetailField({
  label,
  value,
}: {
  label: string;
  value: unknown;
}) {
  return (
    <>
      <dt>{label}</dt>
      <dd dir="auto">{displayText(value)}</dd>
    </>
  );
}

function LongTextBlock({
  label,
  value,
}: {
  label: string;
  value: unknown;
}) {
  return (
    <div className="submission-text-block">
      <strong>{label}</strong>
      <div dir="auto">{displayText(value)}</div>
    </div>
  );
}

function SourceButtons({ submission }: { submission: Submission }) {
  const hasSource = Boolean(submission.art_link);
  const hasUpdated = Boolean(submission.updated_artwork_file_url);

  if (!hasSource && !hasUpdated) return null;

  return (
    <div className="actions">
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

function getSubmissionDerivedFields(submission: Submission) {
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

  const arabicPathway = fallbackText(submission, submission.art_pathway_name_ar, [
    "ArtPathwayNameAr",
  ]);

  const arabicSubpathway = fallbackText(
    submission,
    submission.art_sub_pathway_name_ar,
    ["ArtSubPathwayNameAr"]
  );

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

  const influence = fallbackText(submission, submission.influence_idea_source, [
    "Did anyone or anything influence your idea (family, artist, place)?",
    "Did anyone or anything influence your idea",
  ]);

  const enjoyable = fallbackText(submission, submission.most_enjoyable_part, [
    "What was the most enjoyable part of creating your work?",
    "Most enjoyable part",
  ]);

  const elements = fallbackText(submission, submission.focused_elements, [
    "What elements did you focus on, and why?",
    "What elements did you focus on",
  ]);

  return {
    artworkName: displayText(
      englishTitle,
      displayText(arabicTitle, submission.reference_id)
    ),
    englishTitle,
    arabicTitle,
    englishDescription,
    arabicDescription,
    arabicPathway,
    arabicSubpathway,
    studentNames,
    influence,
    enjoyable,
    elements,
  };
}

export function SubmissionsClient({
  submissions,
  redirectTo,
}: {
  submissions: Submission[];
  redirectTo: string;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selectedSubmission = useMemo(
    () => submissions.find((submission) => submission.id === selectedId) ?? null,
    [selectedId, submissions]
  );

  return (
    <>
      <div className="card">
        <div className="table-title-row">
          <div>
            <h2>Submission Results</h2>
            <p className="muted">
              Showing submissions as rows. Click View to open full details.
            </p>
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Artwork Name</th>
                <th>Reference ID</th>
                <th>Status</th>
                <th>Registration</th>
                <th>Submission Date</th>
                <th>School</th>
                <th>Region</th>
                <th>Pathway</th>
                <th>Updated File</th>
                <th>Action</th>
              </tr>
            </thead>

            <tbody>
              {submissions.map((submission) => {
                const derived = getSubmissionDerivedFields(submission);

                return (
                  <tr key={submission.id}>
                    <td style={{ fontWeight: 800 }} dir="auto">
                      {derived.artworkName}
                    </td>

                    <td>{displayText(submission.reference_id)}</td>

                    <td>
                      <span className="pill">
                        {labelWorkflowStatus(submission.workflow_status)}
                      </span>
                    </td>

                    <td>{displayText(submission.registration_status)}</td>

                    <td>
                      {displayText(
                        submission.submission_date_value ??
                          submission.submission_date
                      )}
                    </td>

                    <td>{displayText(submission.institution_name)}</td>
                    <td>{displayText(submission.school_region)}</td>
                    <td>{displayText(submission.art_pathway_name_en)}</td>

                    <td>
                      {submission.updated_artwork_file_url ? (
                        <a
                          className="btn secondary"
                          href={submission.updated_artwork_file_url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Open Updated File
                        </a>
                      ) : (
                        <span className="muted small">—</span>
                      )}
                    </td>

                    <td>
                      <div className="actions">
                        <button
                          className="btn secondary"
                          type="button"
                          onClick={() => setSelectedId(submission.id)}
                        >
                          View
                        </button>

                        {submission.art_link && (
                          <a
                            className="btn secondary"
                            href={submission.art_link}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Source
                          </a>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}

              {submissions.length === 0 && (
                <tr>
                  <td colSpan={10}>
                    No submissions found for the selected filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selectedSubmission && (
        <SubmissionModal
          submission={selectedSubmission}
          redirectTo={redirectTo}
          onClose={() => setSelectedId(null)}
        />
      )}
    </>
  );
}

function SubmissionModal({
  submission,
  redirectTo,
  onClose,
}: {
  submission: Submission;
  redirectTo: string;
  onClose: () => void;
}) {
  const derived = getSubmissionDerivedFields(submission);

  return (
    <div className="submission-modal-backdrop" role="dialog" aria-modal="true">
      <div className="submission-modal-card">
        <div className="submission-modal-header">
          <div>
            <h2>{derived.artworkName}</h2>
            <p className="muted small" style={{ margin: "4px 0 10px" }}>
              Reference ID: {submission.reference_id}
            </p>
            <span className="pill">
              {labelWorkflowStatus(submission.workflow_status)}
            </span>
          </div>

          <div className="actions">
            <SourceButtons submission={submission} />

            <button className="btn secondary" type="button" onClick={onClose}>
              Close
            </button>
          </div>
        </div>

        <div className="submission-modal-body">
          <div className="card" style={{ boxShadow: "none" }}>
            <h3>Submission Details</h3>

            <dl className="detail-grid">
              <DetailField label="Artwork Name" value={derived.artworkName} />
              <DetailField label="Reference ID" value={submission.reference_id} />
              <DetailField
                label="Registration ID"
                value={submission.registration_id}
              />
              <DetailField
                label="Registration Status"
                value={submission.registration_status}
              />
              <DetailField
                label="Submission Date"
                value={
                  submission.submission_date_value ?? submission.submission_date
                }
              />
              <DetailField label="School" value={submission.institution_name} />
              <DetailField
                label="School Type"
                value={submission.institution_type}
              />
              <DetailField label="Region" value={submission.school_region} />
              <DetailField label="Pathway" value={submission.art_pathway_name_en} />
              <DetailField label="Arabic Pathway" value={derived.arabicPathway} />
              <DetailField
                label="Subpathway"
                value={submission.art_sub_pathway_name_en}
              />
              <DetailField
                label="Arabic Subpathway"
                value={derived.arabicSubpathway}
              />
              <DetailField
                label="Students ESIS"
                value={submission.participating_students_esis_numbers}
              />
              <DetailField label="Students Names" value={derived.studentNames} />
              <DetailField
                label="Students Grades"
                value={submission.participating_students_grades}
              />
              <DetailField
                label="Genders"
                value={submission.participating_students_genders}
              />
              <DetailField
                label="Nationalities"
                value={submission.participating_students_nationalities}
              />

              {submission.artistic_rating && (
                <DetailField
                  label="ADEK Artistic Rating"
                  value={
                    artisticRatingLabels[submission.artistic_rating] ??
                    submission.artistic_rating
                  }
                />
              )}

              {submission.management_artistic_rating && (
                <DetailField
                  label="Management Artistic Rating"
                  value={
                    artisticRatingLabels[submission.management_artistic_rating] ??
                    submission.management_artistic_rating
                  }
                />
              )}

              {submission.updated_artwork_file_url && (
                <DetailField
                  label="Updated Artwork File / Folder"
                  value={submission.updated_artwork_file_name}
                />
              )}
            </dl>

            <div style={{ marginTop: 16 }}>
              <SourceButtons submission={submission} />
            </div>
          </div>

          <div className="card" style={{ boxShadow: "none" }}>
            <h3>Artwork Text</h3>

            <div className="grid grid-2">
              <LongTextBlock label="English Title" value={derived.englishTitle} />
              <LongTextBlock label="Arabic Title" value={derived.arabicTitle} />
              <LongTextBlock
                label="English Description"
                value={derived.englishDescription}
              />
              <LongTextBlock
                label="Arabic Description"
                value={derived.arabicDescription}
              />
              <LongTextBlock
                label="Did anyone or anything influence your idea, such as family, an artist, or a place?"
                value={derived.influence}
              />
              <LongTextBlock
                label="What was the most enjoyable part of creating your work?"
                value={derived.enjoyable}
              />
              <LongTextBlock
                label="What elements did you focus on in your artwork, and why?"
                value={derived.elements}
              />
            </div>
          </div>

          <form
            action="/api/submissions/content"
            method="post"
            className="card"
            style={{ boxShadow: "none" }}
          >
            <input type="hidden" name="id" value={submission.id} />
            <input type="hidden" name="redirect_to" value={redirectTo} />

            <h3>Editable Artwork Text</h3>

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
                  Did anyone or anything influence your idea, such as family, an
                  artist, or a place?
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

            <div className="actions" style={{ marginTop: 12 }}>
              <button className="btn" type="submit">
                Save Text Updates
              </button>

              <button className="btn secondary" type="button" onClick={onClose}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}