// Compares the key sets of messages/es.json and messages/en.json (flattened with dots).
import { existsSync, readFileSync } from 'node:fs';

const files = { es: 'messages/es.json', en: 'messages/en.json' };

if (!existsSync('messages')) {
  console.log('i18n:check - messages/ does not exist yet; skipping (placeholder).');
  process.exit(0);
}

function flatten(obj, prefix = '') {
  return Object.entries(obj).flatMap(([k, v]) =>
    v !== null && typeof v === 'object' ? flatten(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

const keys = {};
for (const [locale, path] of Object.entries(files)) {
  if (!existsSync(path)) {
    console.error(`i18n:check - missing ${path}`);
    process.exit(1);
  }
  keys[locale] = new Set(flatten(JSON.parse(readFileSync(path, 'utf8'))));
}

let failed = false;
for (const [a, b] of [
  ['es', 'en'],
  ['en', 'es'],
]) {
  const missing = [...keys[a]].filter((k) => !keys[b].has(k));
  if (missing.length > 0) {
    failed = true;
    console.error(`Keys in ${a}.json missing from ${b}.json:\n  ${missing.join('\n  ')}`);
  }
}
if (failed) process.exit(1);
console.log(`i18n:check - OK (${keys.es.size} keys in both locales).`);
