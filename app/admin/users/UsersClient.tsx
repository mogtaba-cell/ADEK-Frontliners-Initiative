"use client";

import { RATER_PATHWAYS } from "@/lib/rater-rubric";

const roles = [
  ["admin", "Admin"],
  ["coordinator", "Coordinator"],
  ["evaluator", "ADEK Evaluator"],
  ["management", "Management"],
  ["proofreader", "Proofreader"],
  ["reviewer", "Reviewer"],
  ["categorizer", "Categorizer"],
  ["rater", "Rater"],
  ["literary_subcategorizer", "Literary Subcategorizer"],
  ["adek_hq", "ADEK HQ Read Only"],
];

type UserRow = {
  id: string;
  email: string | null;
  username: string | null;
  full_name: string | null;
  role: string;
  proofreader_type?: string | null;
  is_active: boolean;
  created_at: string;
};

type LinkRow = {
  reviewer_id: string;
  proofreader_id: string;
};

type RaterPathwayLinkRow = {
  rater_id: string;
  pathway: string;
};

export function UsersClient({
  users,
  links,
  raterPathwayLinks,
}: {
  users: UserRow[];
  links: LinkRow[];
  raterPathwayLinks: RaterPathwayLinkRow[];
}) {
  const generalProofreaders = users.filter(
    (u) =>
      u.role === "proofreader" &&
      (u.proofreader_type ?? "general") === "general" &&
      u.is_active
  );

  const reviewers = users.filter((u) => u.role === "reviewer" && u.is_active);
  const raters = users.filter((u) => u.role === "rater" && u.is_active);

  async function updateUser(id: string) {
    const payload = {
      id,
      full_name: (
        document.getElementById(`full_name_${id}`) as HTMLInputElement
      ).value,
      email: (document.getElementById(`email_${id}`) as HTMLInputElement).value,
      username: (
        document.getElementById(`username_${id}`) as HTMLInputElement
      ).value,
      role: (document.getElementById(`role_${id}`) as HTMLSelectElement).value,
      proofreader_type:
        (
          document.getElementById(
            `proofreader_type_${id}`
          ) as HTMLSelectElement
        ).value || null,
      is_active:
        (document.getElementById(`is_active_${id}`) as HTMLSelectElement)
          .value === "true",
      password: (
        document.getElementById(`password_${id}`) as HTMLInputElement
      ).value,
    };

    const res = await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const data = await res.json();
      alert(data.error || "Failed to update user.");
      return;
    }

    alert("User updated.");
    window.location.reload();
  }

  async function saveReviewerLinks(reviewerId: string) {
    const selected = Array.from(
      document.querySelectorAll<HTMLInputElement>(
        `input[data-reviewer='${reviewerId}']:checked`
      )
    ).map((input) => input.value);

    const res = await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: reviewerId,
        reviewer_proofreader_ids: selected,
      }),
    });

    if (!res.ok) {
      const data = await res.json();
      alert(data.error || "Failed to update reviewer links.");
      return;
    }

    alert("Reviewer links updated.");
    window.location.reload();
  }

  async function saveRaterPathwayLinks(raterId: string) {
    const selected = Array.from(
      document.querySelectorAll<HTMLInputElement>(
        `input[data-rater='${raterId}']:checked`
      )
    ).map((input) => input.value);

    const res = await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: raterId,
        rater_pathways: selected,
      }),
    });

    if (!res.ok) {
      const data = await res.json();
      alert(data.error || "Failed to update rater pathway links.");
      return;
    }

    alert("Rater pathway links updated.");
    window.location.reload();
  }

  async function deactivateUser(id: string) {
    if (
      !confirm(
        "Deactivate this user? They will no longer be able to access the system."
      )
    ) {
      return;
    }

    const res = await fetch("/api/admin/users", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });

    if (!res.ok) {
      const data = await res.json();
      alert(data.error || "Failed to deactivate user.");
      return;
    }

    alert("User deactivated.");
    window.location.reload();
  }

  return (
    <>
      <div className="card" style={{ marginTop: 16 }}>
        <h2>Existing Users</h2>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Username</th>
                <th>Role</th>
                <th>Proofreader Type</th>
                <th>Active</th>
                <th>New Password</th>
                <th>Actions</th>
              </tr>
            </thead>

            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>
                    <input
                      className="input"
                      id={`full_name_${u.id}`}
                      defaultValue={u.full_name ?? ""}
                    />
                  </td>

                  <td>
                    <input
                      className="input"
                      id={`email_${u.id}`}
                      defaultValue={u.email ?? ""}
                    />
                  </td>

                  <td>
                    <input
                      className="input"
                      id={`username_${u.id}`}
                      defaultValue={u.username ?? ""}
                    />
                  </td>

                  <td>
                    <select
                      className="input"
                      id={`role_${u.id}`}
                      defaultValue={u.role}
                    >
                      {roles.map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </td>

                  <td>
                    <select
                      className="input"
                      id={`proofreader_type_${u.id}`}
                      defaultValue={u.proofreader_type ?? ""}
                    >
                      <option value="">Not applicable</option>
                      <option value="general">General</option>
                      <option value="literary_arabic">
                        Arabic Literary
                      </option>
                      <option value="literary_english_or_others">
                        English / Other Literary
                      </option>
                    </select>
                  </td>

                  <td>
                    <select
                      className="input"
                      id={`is_active_${u.id}`}
                      defaultValue={u.is_active ? "true" : "false"}
                    >
                      <option value="true">Yes</option>
                      <option value="false">No</option>
                    </select>
                  </td>

                  <td>
                    <input
                      className="input"
                      id={`password_${u.id}`}
                      type="password"
                      placeholder="Leave blank"
                    />
                  </td>

                  <td style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button
                      className="btn"
                      type="button"
                      onClick={() => updateUser(u.id)}
                    >
                      Save
                    </button>

                    <button
                      className="btn secondary"
                      type="button"
                      onClick={() => deactivateUser(u.id)}
                    >
                      Deactivate
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div
        className="card"
        id="reviewer-proofreader-links"
        style={{ marginTop: 16 }}
      >
        <h2>Reviewer / General Proofreader Links</h2>

        <p className="muted">
          Admin assigns specific General Proofreaders to Reviewers here. Tick the
          General Proofreader accounts that belong to each Reviewer, then click
          Save Links. Final review tasks are assigned only to reviewers linked to
          the General Proofreader who completed the artwork.
        </p>

        <div className="grid grid-2">
          {reviewers.map((reviewer) => {
            const linked = new Set(
              links
                .filter((link) => link.reviewer_id === reviewer.id)
                .map((link) => link.proofreader_id)
            );

            return (
              <div
                className="card"
                key={reviewer.id}
                style={{ boxShadow: "none" }}
              >
                <h3>{reviewer.full_name}</h3>

                <div className="grid">
                  {generalProofreaders.map((proofreader) => (
                    <label key={proofreader.id} className="actions small">
                      <input
                        data-reviewer={reviewer.id}
                        type="checkbox"
                        value={proofreader.id}
                        defaultChecked={linked.has(proofreader.id)}
                      />

                      {proofreader.full_name}
                    </label>
                  ))}

                  {generalProofreaders.length === 0 && (
                    <p className="muted">No active General Proofreaders yet.</p>
                  )}

                  <button
                    className="btn"
                    type="button"
                    onClick={() => saveReviewerLinks(reviewer.id)}
                  >
                    Save Links
                  </button>
                </div>
              </div>
            );
          })}

          {reviewers.length === 0 && (
            <p className="muted">No active reviewers yet.</p>
          )}
        </div>
      </div>

      <div
        className="card"
        id="rater-pathway-links"
        style={{ marginTop: 16 }}
      >
        <h2>Rater / Pathway Links</h2>

        <p className="muted">
          Raters only receive Artistic Grading tasks for the categorized pathways
          selected here. Tick one or more pathways for each active Rater, then
          click Save Pathways.
        </p>

        <div className="grid grid-3">
          {raters.map((rater) => {
            const linked = new Set(
              raterPathwayLinks
                .filter((link) => link.rater_id === rater.id)
                .map((link) => link.pathway)
            );

            return (
              <div className="card" key={rater.id} style={{ boxShadow: "none" }}>
                <h3>{rater.full_name}</h3>
                <p className="muted small">{rater.email}</p>

                <div className="grid">
                  {RATER_PATHWAYS.map((pathway) => (
                    <label key={pathway} className="actions small">
                      <input
                        data-rater={rater.id}
                        type="checkbox"
                        value={pathway}
                        defaultChecked={linked.has(pathway)}
                      />

                      {pathway}
                    </label>
                  ))}

                  <button
                    className="btn"
                    type="button"
                    onClick={() => saveRaterPathwayLinks(rater.id)}
                  >
                    Save Pathways
                  </button>
                </div>
              </div>
            );
          })}

          {raters.length === 0 && <p className="muted">No active raters yet.</p>}
        </div>
      </div>
    </>
  );
}