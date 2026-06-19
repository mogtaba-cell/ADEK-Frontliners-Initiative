import Link from "next/link";
import type { Role } from "@/lib/types";

const links: Record<Role, { href: string; label: string }[]> = {
  admin: [
    { href: "/admin", label: "Admin" },
    { href: "/admin/import", label: "Import" },
    { href: "/admin/users", label: "Users" },
    { href: "/admin/literary-language", label: "Literary Language" },
    { href: "/submissions", label: "All Submissions" },
    { href: "/analytics", label: "Analytics" },
    { href: "/admin/export", label: "Export" },
  ],
  coordinator: [{ href: "/coordinator", label: "Correction Workspace" }],
  evaluator: [
    { href: "/evaluator", label: "Evaluation Criteria" },
    { href: "/evaluator/work", label: "Evaluation Workspace" },
  ],
  management: [
    { href: "/management", label: "Management Review" },
    { href: "/management/work", label: "Needs Review Workspace" },
  ],
  proofreader: [{ href: "/proofreader", label: "Proofreading Workspace" }],
  reviewer: [{ href: "/reviewer", label: "Review Workspace" }],
  categorizer: [{ href: "/categorizer", label: "Categorization Workspace" }],
  rater: [{ href: "/rater", label: "Artistic Ranking Workspace" }],
  adek_hq: [
    { href: "/submissions", label: "Submissions" },
    { href: "/analytics", label: "Analytics" },
  ],
};

export function Nav({ role }: { role: Role }) {
  return (
    <nav className="nav">
      {(links[role] ?? []).map((link) => (
        <Link key={link.href} href={link.href}>
          {link.label}
        </Link>
      ))}

      <a href="/api/auth/logout">Logout</a>
    </nav>
  );
}