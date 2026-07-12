type ComingSoonProps = {
  title: string;
};

export default function ComingSoon({ title }: ComingSoonProps) {
  return (
    <div>
      <h1 className="text-2xl font-semibold text-[#0f2744]">{title}</h1>
      <p className="mt-2 text-slate-600">Coming soon</p>
    </div>
  );
}
