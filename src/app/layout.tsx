import type { ReactNode } from 'react';
import './globals.css';

// Placeholder root layout. The frontend workstream replaces this with [locale] routing.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
