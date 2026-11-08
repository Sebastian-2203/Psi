import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * QA gap tests (Phase 1, I18N-01): beyond key parity (scripts/check-i18n.mjs), check that
 * values are non-empty, ICU placeholders match across locales, Spanish auth copy uses the
 * informal "tu" register decided on 2026-11-08 (never "usted"), and every literal translation
 * key used in a single-namespace source file exists in both catalogs.
 */
type Tree = { [k: string]: string | Tree };
const es = JSON.parse(readFileSync('messages/es.json', 'utf8')) as Tree;
const en = JSON.parse(readFileSync('messages/en.json', 'utf8')) as Tree;

function flatten(tree: Tree, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  for (const [k, v] of Object.entries(tree)) {
    if (typeof v === 'string') out.set(`${prefix}${k}`, v);
    else for (const [kk, vv] of flatten(v, `${prefix}${k}.`)) out.set(kk, vv);
  }
  return out;
}
const esFlat = flatten(es);
const enFlat = flatten(en);

function placeholders(s: string): string[] {
  // Top-level ICU argument names: {name}, {count, plural, ...}
  return [...s.matchAll(/\{\s*([A-Za-z_][\w]*)\s*[,}]/g)].map((m) => m[1]!).sort();
}

describe('message catalogs', () => {
  it('have no empty values', () => {
    for (const [name, flat] of [
      ['es', esFlat],
      ['en', enFlat],
    ] as const) {
      const empty = [...flat].filter(([, v]) => v.trim() === '').map(([k]) => k);
      expect(empty, `${name}.json empty values`).toEqual([]);
    }
  });

  it('use the same ICU placeholders in es and en', () => {
    const mismatches: string[] = [];
    for (const [key, value] of esFlat) {
      const other = enFlat.get(key);
      if (other === undefined) continue;
      if (placeholders(value).join() !== placeholders(other).join()) mismatches.push(key);
    }
    expect(mismatches).toEqual([]);
  });

  it('Spanish auth copy uses "tu" register, never "usted" forms', () => {
    const auth = [...esFlat].filter(([k]) => k.startsWith('auth.'));
    expect(auth.length).toBeGreaterThan(20);
    const formal = auth.filter(([, v]) =>
      /\b(usted|ustedes|su (cuenta|correo|contraseña|código))\b/i.test(v),
    );
    expect(formal.map(([k]) => k)).toEqual([]);
  });

  it('auth namespace is present and non-trivial in both locales', () => {
    const count = (f: Map<string, string>) =>
      [...f.keys()].filter((k) => k.startsWith('auth.')).length;
    expect(count(esFlat)).toBe(count(enFlat));
  });
});

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(n) ? [p] : [];
  });
}

describe('translation keys referenced in source exist', () => {
  it('literal t("...") keys of single-namespace files resolve in es and en', () => {
    const missing: string[] = [];
    let checked = 0;
    for (const file of walk('src')) {
      const src = readFileSync(file, 'utf8');
      const calls = [
        ...src.matchAll(
          /(?:useTranslations|getTranslations)\(\s*(?:\{[^}]*namespace:\s*)?(?:'([\w.]+)')?/g,
        ),
      ].map((m) => m[1] ?? '');
      const namespaces = calls.filter((n) => n !== '');
      if (calls.length !== namespaces.length) continue; // root-scoped call present: ambiguous
      if (new Set(namespaces).size !== 1) continue; // ambiguous: skip rather than guess
      const ns = namespaces[0]!;
      for (const m of src.matchAll(/\bt(?:\.rich|\.raw)?\(\s*'([\w.]+)'/g)) {
        const key = `${ns}.${m[1]}`;
        checked += 1;
        if (!esFlat.has(key) || !enFlat.has(key)) missing.push(`${file}: ${key}`);
      }
    }
    expect(checked).toBeGreaterThan(30);
    expect(missing).toEqual([]);
  });
});
