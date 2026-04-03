interface MobilePageHeadingProps {
  kicker: string;
  title: string;
  description: string;
  aside?: React.ReactNode;
}

export function MobilePageHeading({ kicker, title, description, aside }: MobilePageHeadingProps) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="brand-kicker">{kicker}</p>
        <h1 className="mt-2 text-xl font-semibold tracking-tight text-slate-100">{title}</h1>
        <p className="mt-2 text-sm leading-6 text-slate-400">{description}</p>
      </div>
      {aside ? <div className="shrink-0">{aside}</div> : null}
    </div>
  );
}