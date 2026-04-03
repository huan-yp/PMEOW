export function MobileEmptyState({
  icon,
  title,
  description,
}: {
  icon?: string;
  title: string;
  description?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      {icon && <span className="mb-3 text-4xl">{icon}</span>}
      <p className="text-sm font-medium text-slate-400">{title}</p>
      {description && <p className="mt-1 text-xs text-slate-500">{description}</p>}
    </div>
  );
}
