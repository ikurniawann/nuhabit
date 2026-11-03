import type { ReactNode } from 'react';

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '0.5rem',
        padding: '2.5rem 1rem',
        textAlign: 'center',
      }}
    >
      <p style={{ fontWeight: 700 }}>{title}</p>
      {hint ? <p style={{ fontSize: '0.875rem', color: 'var(--color-nh-muted)' }}>{hint}</p> : null}
      {action}
    </div>
  );
}
