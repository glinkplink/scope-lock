#!/usr/bin/env node
/**
 * Fail if src/ references VITE_* names that look like server secrets.
 * Allowed: public client vars (Supabase URL/anon, Geoapify, Stripe publishable).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const srcRoot = join(__dirname, '..', 'src');

const ALLOWED_VITE = new Set([
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
  'VITE_GEOAPIFY_API_KEY',
  'VITE_STRIPE_PUBLISHABLE_KEY',
]);

/** import.meta.env.VITE_FOO — capture FOO part */
const VITE_ENV_RE = /import\.meta\.env\.(VITE_[A-Z0-9_]+)/g;

const problems = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === 'node_modules' || name.startsWith('.')) continue;
      walk(p);
    } else if (['.ts', '.tsx'].includes(extname(name))) {
      const text = readFileSync(p, 'utf8');
      let m;
      while ((m = VITE_ENV_RE.exec(text)) !== null) {
        const key = m[1];
        if (ALLOWED_VITE.has(key)) continue;
        if (/SECRET|SERVICE_ROLE|STRIPE_SECRET|WEBHOOK|PRIVATE/i.test(key)) {
          problems.push(`${p}: disallowed ${key}`);
        }
      }
    }
  }
}

walk(srcRoot);

if (problems.length > 0) {
  console.error('check-vite-public-env: forbidden VITE_* client env references:\n', problems.join('\n'));
  process.exit(1);
}

console.log('check-vite-public-env: ok');
