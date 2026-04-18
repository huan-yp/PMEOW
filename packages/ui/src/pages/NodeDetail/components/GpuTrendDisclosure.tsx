import type { ReactNode } from 'react';

export function GpuTrendDisclosure(props: {
  title: string;
  subtitle: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-dark-border bg-dark-bg/60">
      <button
        type="button"
        onClick={props.onToggle}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <div>
          <div className="text-sm font-medium text-slate-200">{props.title}</div>
          <div className="text-xs text-slate-500">{props.subtitle}</div>
        </div>
        <span className="text-xs text-slate-400">{props.open ? '收起' : '展开'}</span>
      </button>
      {props.open && <div className="border-t border-dark-border px-4 py-4">{props.children}</div>}
    </div>
  );
}
