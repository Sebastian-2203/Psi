import { cleanup, render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import messages from '../../messages/es.json';
import { EmptyState } from '@/components/shared/empty-state';
import { ErrorState } from '@/components/shared/error-state';
import { ThemeVariables } from '@/components/shared/theme-variables';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { formatDate, formatNumber } from '@/i18n/formatters';
import { DEFAULT_BRAND } from '@/styles/default-brand';
import { Inbox } from 'lucide-react';

const wrap = (ui: ReactNode) => (
  <NextIntlClientProvider locale="es" messages={messages}>
    {ui}
  </NextIntlClientProvider>
);

afterEach(cleanup);

describe('Button', () => {
  it('renders the destructive variant as an outline button (not filled)', () => {
    render(<Button variant="destructive">Eliminar paciente</Button>);
    const btn = screen.getByRole('button', { name: 'Eliminar paciente' });
    expect(btn.className).toContain('border-destructive');
    expect(btn.className).toContain('bg-card');
    expect(btn.className).not.toContain('bg-destructive ');
  });

  it('is disabled and busy while loading', () => {
    render(<Button loading>Guardar</Button>);
    const btn = screen.getByRole('button', { name: 'Guardar' });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    expect(btn.getAttribute('aria-busy')).toBe('true');
  });
});

describe('Alert', () => {
  it('uses role=alert with an icon and a text status for errors (never colour alone)', () => {
    render(wrap(<Alert variant="error">Algo falló</Alert>));
    const alert = screen.getByRole('alert');
    expect(alert.querySelector('svg')).not.toBeNull();
    expect(alert.textContent).toContain('Error:');
    expect(alert.textContent).toContain('Algo falló');
  });

  it('uses role=status for non-error variants', () => {
    render(wrap(<Alert variant="success">Guardado</Alert>));
    expect(screen.getByRole('status').textContent).toContain('Listo:');
  });
});

describe('states', () => {
  it('EmptyState shows title, description and action', () => {
    render(
      <EmptyState
        icon={Inbox}
        title="Sin datos"
        description="Nada aún"
        action={<button>Crear</button>}
      />,
    );
    expect(screen.getByText('Sin datos')).toBeTruthy();
    expect(screen.getByText('Nada aún')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Crear' })).toBeTruthy();
  });

  it('ErrorState defaults to the translated copy with reassurance', () => {
    render(wrap(<ErrorState />));
    expect(screen.getByRole('alert').textContent).toContain('Tus datos están a salvo');
  });
});

describe('ThemeVariables', () => {
  it('emits nothing for the default brand (tokens.css already matches)', () => {
    expect(renderToStaticMarkup(<ThemeVariables brand={DEFAULT_BRAND} />)).toBe('');
  });

  it('emits tenant CSS variables for a valid custom brand', () => {
    const html = renderToStaticMarkup(
      <ThemeVariables brand={{ slug: 'acme', displayName: 'Acme', brandColor: '#2a6f97' }} />,
    );
    expect(html).toContain('[data-tenant="acme"]');
    expect(html).toContain('--primary:#');
  });

  it('emits nothing for invalid branding (rejected, never rendered)', () => {
    const html = renderToStaticMarkup(
      <ThemeVariables brand={{ slug: 'bad"slug', displayName: 'X', brandColor: '#2a6f97' }} />,
    );
    expect(html).toBe('');
  });
});

describe('formatters', () => {
  it('formats dates in the org time zone and locale', () => {
    // 2026-11-08T03:00Z is still 07 Nov in Bogota (UTC-5)
    const d = '2026-11-08T03:00:00Z';
    expect(formatDate(d, 'es', { style: 'long' })).toContain('7');
    expect(formatDate(d, 'en', { style: 'long' })).toContain('November 7');
  });

  it('formats numbers per locale', () => {
    expect(formatNumber(1234.5, 'en')).toBe('1,234.5');
    expect(formatNumber(1234.5, 'es')).toMatch(/1\.?234,5/);
  });
});
