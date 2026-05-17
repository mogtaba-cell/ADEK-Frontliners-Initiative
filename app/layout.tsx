import "./globals.css";
import { BrandHeader } from "@/components/brand-header";
import { GlobalLoading } from "@/components/global-loading";

export const metadata = {
  title: "ADEK Frontliners Initiative",
  description: "Artwork evaluation workflow system",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <GlobalLoading />
        <BrandHeader />
        {children}
      </body>
    </html>
  );
}