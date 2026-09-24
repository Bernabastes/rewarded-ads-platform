import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils/cn';

export type AlertTone = 'info' | 'success' | 'warning' | 'danger';

const TONES: Record<AlertTone, { wrapper: string; icon: typeof Info }> = {
  info: { wrapper: 'border-info/25 bg-info/8 text-fg [&_svg]:text-info', icon: Info },
  success: { wrapper: 'border-success/25 bg-success/8 text-fg [&_svg]:text-success', icon: CheckCircle2 },
  warning: { wrapper: 'border-warning/35 bg-warning/10 text-fg [&_svg]:text-[#a56f00] dark:[&_svg]:text-warning', icon: AlertTriangle },
  danger: { wrapper: 'border-danger/25 bg-danger/8 text-fg [&_svg]:text-danger', icon: XCircle },
};

export interface AlertProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  tone?: AlertTone;
  title?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
}

export function Alert({ tone = 'info', title, action, icon, className, children, ...props }: AlertProps) {
  const Icon = TONES[tone].icon;
  return (
    <div
      role={tone === 'danger' || tone === 'warning' ? 'alert' : 'status'}
      className={cn('flex gap-3 rounded-md border px-4 py-3.5 text-sm', TONES[tone].wrapper, className)}
      {...props}
    >
      <span className="mt-0.5 shrink-0" aria-hidden="true">
        {icon ?? <Icon className="size-5" />}
      </span>
      <div className="min-w-0 flex-1">
        {title && <p className="font-medium text-fg">{title}</p>}
        {children && <div className={cn('text-fg-muted', title && 'mt-0.5')}>{children}</div>}
      </div>
      {action && <div className="shrink-0 self-center">{action}</div>}
    </div>
  );
}
