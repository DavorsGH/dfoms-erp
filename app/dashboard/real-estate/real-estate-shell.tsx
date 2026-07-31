import RealEstateNav from "./real-estate-nav";

type RealEstateShellProps = {
  children: React.ReactNode;
  sectionTitle: string;
};

export default function RealEstateShell({
  children,
  sectionTitle,
}: RealEstateShellProps) {
  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-[#0f2744]">Real Estate</h1>
      <RealEstateNav />
      <h2 className="mb-6 text-xl font-semibold text-[#0f2744]">{sectionTitle}</h2>
      {children}
    </div>
  );
}
