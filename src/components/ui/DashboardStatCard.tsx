import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

type DashboardStatCardProps = {
  label: string;
  value: string | number;
  accent?: string;
  className?: string;
  badge?: ReactNode;
  compact?: boolean;
};

function isNumericLike(value: string | number) {
  return typeof value === 'number' || /^-?\d+(\.\d+)?$/.test(value);
}

export default function DashboardStatCard({
  label,
  value,
  accent,
  className,
  badge,
  compact = false,
}: DashboardStatCardProps) {
  const numericValue = isNumericLike(value);
  const badgeContent = badge ?? value;

  return (
    <div
      className={cn(
        'flex rounded-xl border border-border/60 bg-white/[0.88] shadow-sm dark:bg-slate-950/[0.55]',
        compact ? 'min-h-[68px] p-2.5' : 'min-h-[112px] p-4',
        className,
      )}
    >
      <div className="flex h-full w-full items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div
            className={cn(
              'break-keep font-medium uppercase leading-4 text-muted-foreground',
              compact ? 'text-[9px] tracking-[0.14em]' : 'text-[11px] tracking-[0.22em]',
            )}
          >
            {label}
          </div>
          <div
            className={cn(
              'break-keep font-semibold tabular-nums text-foreground',
              compact
                ? numericValue
                  ? 'mt-0.5 text-lg leading-none'
                  : 'mt-0.5 text-base leading-tight'
                : numericValue
                  ? 'mt-2 text-3xl leading-none'
                  : 'mt-2 text-2xl leading-tight',
            )}
          >
            {value}
          </div>
        </div>
        {accent ? (
          <div
            className={cn(
              'flex shrink-0 items-center justify-center rounded-lg font-semibold leading-tight tabular-nums',
              compact ? 'h-7 min-w-7 px-1.5 text-[10px]' : 'h-10 min-w-10 rounded-xl px-2 text-xs',
              !compact && !numericValue && 'min-w-[4.75rem] px-3 text-[11px]',
              accent,
            )}
          >
            <span className={cn('block text-center', numericValue ? 'max-w-[3.5rem] truncate' : 'whitespace-nowrap')}>
              {badgeContent}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
