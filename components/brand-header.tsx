import { KpiHeader } from "@/components/kpi-header";

export function BrandHeader() {
  return (
    <header className="brand-header">
      <div className="brand-header-inner">
        <img className="brand-logo" src="/brand/nae-logo.png" alt="National Art Expressions logo" />
        <div className="brand-title">
          <h1>ADEK Frontliners Initiative</h1>
          <p>Evaluation, selection, proofreading, review, and analytics system</p>
        </div>
      </div>
      <div className="brand-header-inner brand-header-kpis">
        <KpiHeader />
      </div>
    </header>
  );
}
