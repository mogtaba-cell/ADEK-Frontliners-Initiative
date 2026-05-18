const fs = require("fs");
const path = require("path");

const filePath = path.join(process.cwd(), "components", "workspace-client.tsx");

let s = fs.readFileSync(filePath, "utf8");

// 1. Remove invalid correction sources from Coordinator/Task Flow labels.
s = s.replace(
`const correctionSourceLabels: Record<string, string> = {
  adek_evaluation: "ADEK Evaluation",
  proofreading: "General Proofreading",
  literary_proofreading: "Literary Proofreading",
  final_review: "Final Review",
  management_review: "Management Review",
  coordinator_check: "Coordinator Correction",
};`,
`const correctionSourceLabels: Record<string, string> = {
  adek_evaluation: "ADEK Evaluation",
  proofreading: "General Proofreading",
  literary_proofreading: "Literary Proofreading",
  coordinator_check: "Coordinator Correction",
};`
);

// 2. Add reviewer original-vs-updated comparison helpers.
const detailFieldMarker = `function DetailField({ label, value }: { label: string; value: unknown }) {`;

const reviewerHelpers = `
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

`;

if (!s.includes("function ReviewerOriginalUpdatedComparison")) {
  s = s.replace(detailFieldMarker, reviewerHelpers + detailFieldMarker);
}

// 3. Add Literary Criteria card.
const coordinatorUploadMarker = `function CoordinatorUpdatedArtworkUpload({`;

const literaryCriteriaCard = `
function LiteraryCriteriaCard() {
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Criteria for Literary Proofreading</h3>

      <div className="grid grid-3">
        <div className="submission-text-block">
          <strong>Proofreading and linguistic editing</strong>
          <div dir="rtl">??????? ?????? ????????</div>
        </div>

        <div className="submission-text-block">
          <strong>
            Reviewing content and assessing its suitability for publication
          </strong>
          <div dir="rtl">?????? ??????? ?????? ??????? ?????</div>
        </div>

        <div className="submission-text-block">
          <strong>
            Ensuring alignment of the submissions with the objectives of the
            initiative
          </strong>
          <div dir="rtl">?????? ?? ????? ?????? ?? ????? ????????</div>
        </div>
      </div>
    </div>
  );
}

`;

if (!s.includes("function LiteraryCriteriaCard")) {
  s = s.replace(coordinatorUploadMarker, literaryCriteriaCard + coordinatorUploadMarker);
}

// 4. Add literary suitability state.
s = s.replace(
`  const [generalProofreaderDecision, setGeneralProofreaderDecision] =
    useState("ready");`,
`  const [generalProofreaderDecision, setGeneralProofreaderDecision] =
    useState("ready");
  const [literaryPublicationSuitable, setLiteraryPublicationSuitable] =
    useState("yes");`
);

// 5. Keep a selected assignment fallback.
s = s.replace(
`  const selectedAssignment = useMemo(
    () =>
      assignments.find((assignment) => assignment.id === selectedId) ?? null,
    [assignments, selectedId]
  );`,
`  const selectedAssignment = useMemo(
    () =>
      assignments.find((assignment) => assignment.id === selectedId) ??
      assignments[0] ??
      null,
    [assignments, selectedId]
  );`
);

// 6. Reset selection when assignment list changes.
const selectedSubmissionEffectMarker = `  useEffect(() => {
    if (!selectedSubmission) return;`;

const selectedIdResetEffect = `  useEffect(() => {
    if (!assignments.length) {
      setSelectedId(null);
      return;
    }

    if (!selectedId || !assignments.some((assignment) => assignment.id === selectedId)) {
      setSelectedId(assignments[0].id);
    }
  }, [assignments, selectedId]);

`;

if (!s.includes("if (!assignments.length)")) {
  s = s.replace(selectedSubmissionEffectMarker, selectedIdResetEffect + selectedSubmissionEffectMarker);
}

// 7. Reset literary suitability per selected submission.
s = s.replace(
`    setGeneralProofreaderDecision("ready");
  }, [selectedSubmission?.id]);`,
`    setGeneralProofreaderDecision("ready");

    setLiteraryPublicationSuitable(
      selectedSubmission.literary_publication_suitable === false ? "no" : "yes"
    );
  }, [selectedSubmission?.id]);`
);

// 8. Add limited details view flag.
s = s.replace(
`  const liveAdekDecision = calculateAdekDecisionLabel(
    culturalAuthenticity,
    artisticExcellence,
    ethicalAppropriateness
  );`,
`  const liveAdekDecision = calculateAdekDecisionLabel(
    culturalAuthenticity,
    artisticExcellence,
    ethicalAppropriateness
  );

  const isLimitedSubmissionDetailsView =
    phase === "adek_evaluation" ||
    phase === "proofreading" ||
    phase === "literary_proofreading";`
);

// 9. Limit sidebar details for ADEK + proofreaders.
s = s.replace(
`                <span>{submission?.institution_name ?? "Unknown school"}</span>`,
`                {!isLimitedSubmissionDetailsView && (
                  <span>{submission?.institution_name ?? "Unknown school"}</span>
                )}

                {isLimitedSubmissionDetailsView && (
                  <span>
                    {submission?.art_pathway_name_en ?? "Unknown pathway"} ·{" "}
                    {normalizeGrade(
                      submission?.participating_students_grades
                    ) || "Grade unavailable"}
                  </span>
                )}`
);

// 10. Show literary criteria on literary workspace.
s = s.replace(
`      <section className="workspace-main">
        {!selectedAssignment || !selectedSubmission || !derived ? (`,
`      <section className="workspace-main">
        {phase === "literary_proofreading" && <LiteraryCriteriaCard />}

        {!selectedAssignment || !selectedSubmission || !derived ? (`
);

// 11. Hide Reference ID from limited roles.
s = s.replace(
`                  <p className="muted small">
                    Reference ID: {selectedSubmission.reference_id}
                  </p>`,
`                  {!isLimitedSubmissionDetailsView && (
                    <p className="muted small">
                      Reference ID: {selectedSubmission.reference_id}
                    </p>
                  )}`
);

// 12. Replace the submission detail grid.
const detailGridStart = `              <dl className="detail-grid" style={{ marginTop: 18 }}>`;
const detailGridEnd = `              </dl>

              <SourceButtons submission={selectedSubmission} />`;

const detailGridReplacement = `              <dl className="detail-grid" style={{ marginTop: 18 }}>
                {isLimitedSubmissionDetailsView ? (
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

                {!isLimitedSubmissionDetailsView && selectedSubmission.artistic_rating && (
                  <DetailField
                    label="ADEK Artistic Rating"
                    value={
                      artisticRatingLabels[selectedSubmission.artistic_rating] ??
                      selectedSubmission.artistic_rating
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

              <SourceButtons submission={selectedSubmission} />`;

const detailGridStartIndex = s.indexOf(detailGridStart);
const detailGridEndIndex = s.indexOf(detailGridEnd, detailGridStartIndex);

if (detailGridStartIndex !== -1 && detailGridEndIndex !== -1) {
  s =
    s.slice(0, detailGridStartIndex) +
    detailGridReplacement +
    s.slice(detailGridEndIndex + detailGridEnd.length);
}

// 13. Add reviewer comparison and hide artwork text from ADEK evaluator.
s = s.replace(
`            <div className="card">
              <h3>Artwork Text and Narrative</h3>`,
`            {phase === "final_review" && (
              <ReviewerOriginalUpdatedComparison
                submission={selectedSubmission}
                derived={derived}
              />
            )}

            {phase !== "adek_evaluation" && (
              <div className="card">
                <h3>Artwork Text and Narrative</h3>`
);

s = s.replace(
`              </div>
            </div>

            <form`,
`              </div>
              </div>
            )}

            <form`
);

// 14. Key form by assignment and submission.
s = s.replace(
`              key={selectedAssignment.id}`,
`              key={\`\${selectedAssignment.id}-\${selectedSubmission.id}\`}`
);

// 15. Add literary explanatory note to task header.
s = s.replace(
`                  {phase === "adek_evaluation" && (
                    <p className="muted small" style={{ marginBottom: 0 }}>
                      First confirm whether the submitted file is clear enough to
                      evaluate. If it is clear, the rubric will appear and the
                      decision will be calculated automatically.
                    </p>
                  )}`,
`                  {phase === "adek_evaluation" && (
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
                  )}`
);

// 16. Replace literary proofreading block.
const literaryStart = `              {phase === "literary_proofreading" && (`;
const managementStart = `              {phase === "management_review" && (`;

const literaryBlock = `              {phase === "literary_proofreading" && (
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
                        ?? ?????? ????? ????? ?? ????? ????????? ??? ?? ?????
                        ??????
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
                        <option value="yes">??? / Yes</option>
                        <option value="no">?? / No</option>
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
                          key={\`literary-content-\${selectedSubmission.id}\`}
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

`;

const literaryStartIndex = s.indexOf(literaryStart);
const managementStartIndex = s.indexOf(managementStart, literaryStartIndex);

if (literaryStartIndex !== -1 && managementStartIndex !== -1) {
  s =
    s.slice(0, literaryStartIndex) +
    literaryBlock +
    s.slice(managementStartIndex);
}

// 17. Replace final action buttons.
const actionsMarker = `              <div className="actions" style={{ marginTop: 16 }}>`;
const formEndMarker = `            </form>`;

const formEndIndex = s.indexOf(formEndMarker);
const actionsIndex = s.lastIndexOf(actionsMarker, formEndIndex);
const actionsCloseIndex = s.indexOf(`              </div>`, actionsIndex);

const actionButtons = `              <div className="actions" style={{ marginTop: 16 }}>
                {phase === "literary_proofreading" ? (
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
                      phase === "adek_evaluation" && adekFileQualityClear === "no"
                        ? "send_correction"
                        : "complete"
                    }
                  >
                    {phase === "coordinator_check"
                      ? "Ready for Proofreader"
                      : phase === "final_review"
                        ? "Mark as Ready"
                        : phase === "adek_evaluation" &&
                            adekFileQualityClear === "no"
                          ? "Send for Correction"
                          : "Mark Done & Open Next"}
                  </button>
                )}
              </div>`;

if (actionsIndex !== -1 && actionsCloseIndex !== -1) {
  s =
    s.slice(0, actionsIndex) +
    actionButtons +
    s.slice(actionsCloseIndex + `              </div>`.length);
}

// 18. Add stable keys to edit fields.
s = s.replaceAll(
`<EditableArtworkText derived={derived} />`,
`<EditableArtworkText key={\`edit-\${selectedSubmission.id}\`} derived={derived} />`
);

fs.writeFileSync(filePath, s);
console.log("Updated components/workspace-client.tsx");
