import { KpiHeader } from "@/components/kpi-header";

export function BrandHeader() {
  return (
    <header className="brand-header">
      <div className="brand-header-inner">
        <img className="brand-logo" src="/brand/nae-logo.png" alt="National Art Expressions logo" />
        <div className="brand-title">
          <h1>ADEK Frontliners Tribute Initiative</h1>
        </div>
      </div>
      <div className="brand-header-inner brand-header-kpis">
        <KpiHeader />
      </div>
    </header>
  );
}
