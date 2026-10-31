import type { ReactNode } from 'react';

/** A "?" that explains a number in plain words on hover or tap. */
export function Info({ children }: { children: ReactNode }) {
  return (
    <span className="info" tabIndex={0}>
      ?<span className="info-pop">{children}</span>
    </span>
  );
}
