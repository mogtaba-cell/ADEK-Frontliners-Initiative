"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type ChartRow = { name: string; value: number; percentage?: number };
type UserProgressRow = { user: string; role: string; assigned: number; completed: number; remaining: number; completionRate: number };

type Props = {
  nationalityPie: ChartRow[];
  nationalityTable: ChartRow[];
  byPathway: ChartRow[];
  bySubpathway: ChartRow[];
  bySchoolType: ChartRow[];
  byRegion: ChartRow[];
  uniqueSchoolsByRegion: ChartRow[];
  uniqueSchoolsByType: ChartRow[];
  userProgress: UserProgressRow[];
};

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="card"><h2>{title}</h2><div style={{ width: "100%", height: 320 }}>{children}</div></div>;
}

function EmptyAwareBarChart({ data }: { data: ChartRow[] }) {
  if (!data.length) return <p className="muted">No data available for the selected filters.</p>;
  return (
    <ResponsiveContainer>
      <BarChart data={data} margin={{ top: 10, right: 18, left: 0, bottom: 60 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="name" angle={-35} textAnchor="end" interval={0} height={80} />
        <YAxis allowDecimals={false} />
        <Tooltip />
        <Bar dataKey="value" fill="#1C3E3B" />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function AnalyticsClient({ nationalityPie, nationalityTable, byPathway, bySubpathway, bySchoolType, byRegion, uniqueSchoolsByRegion, uniqueSchoolsByType, userProgress }: Props) {
  return (
    <div className="grid" style={{ marginTop: 16 }}>
      <div className="grid grid-2">
        <ChartCard title="Unique Students: UAE vs Non-UAE">
          {nationalityPie.length ? (
            <ResponsiveContainer>
              <PieChart>
                <Pie data={nationalityPie} dataKey="value" nameKey="name" outerRadius={105} label>
                  {nationalityPie.map((entry) => <Cell key={entry.name} fill={entry.name === "UAE" ? "#1C3E3B" : "#B2C7C0"} />)}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          ) : <p className="muted">No student nationality data available.</p>}
        </ChartCard>

        <div className="card">
          <h2>All Unique Student Nationalities</h2>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Nationality</th><th>Unique Students</th><th>Percentage</th></tr></thead>
              <tbody>
                {nationalityTable.map((row) => <tr key={row.name}><td>{row.name}</td><td>{row.value}</td><td>{row.percentage?.toFixed(2)}%</td></tr>)}
                {nationalityTable.length === 0 && <tr><td colSpan={3}>No nationality data.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="grid grid-2">
        <ChartCard title="Submissions per Pathway"><EmptyAwareBarChart data={byPathway} /></ChartCard>
        <ChartCard title="Submissions per Subpathway"><EmptyAwareBarChart data={bySubpathway} /></ChartCard>
      </div>

      <div className="grid grid-2">
        <ChartCard title="Submissions per School Type"><EmptyAwareBarChart data={bySchoolType} /></ChartCard>
        <ChartCard title="Submissions per Region"><EmptyAwareBarChart data={byRegion} /></ChartCard>
      </div>

      <div className="grid grid-2">
        <ChartCard title="Unique Schools per Region"><EmptyAwareBarChart data={uniqueSchoolsByRegion} /></ChartCard>
        <ChartCard title="Unique Schools per School Type"><EmptyAwareBarChart data={uniqueSchoolsByType} /></ChartCard>
      </div>

      <div className="card">
        <h2>User Task Progress</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>User</th><th>Role</th><th>Assigned</th><th>Completed</th><th>Remaining</th><th>Completion Rate</th></tr></thead>
            <tbody>
              {userProgress.map((row) => <tr key={`${row.role}-${row.user}`}><td>{row.user}</td><td>{row.role}</td><td>{row.assigned}</td><td>{row.completed}</td><td>{row.remaining}</td><td>{row.completionRate.toFixed(1)}%</td></tr>)}
              {userProgress.length === 0 && <tr><td colSpan={6}>No user assignment data yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
