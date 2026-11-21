import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Verifies the compiled Vite bundle (`dist/assets/*.js`) contains zero
 * accidentally embedded server secrets or provider tokens before deployment.
 */
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const assetsDir = path.resolve(scriptDir, '..', 'dist', 'assets');
const files = fs.existsSync(assetsDir)
  ? fs.readdirSync(assetsDir).filter((file) => file.endsWith('.js')).sort()
  : [];

const patterns = [
  { name: 'sk_live_', regex: /sk_live_/g },
  { name: 'sk_test_', regex: /sk_test_/g },
  { name: 'sk-proj-', regex: /sk-proj-/g },
  { name: 'xai-', regex: /xai-/g },
  { name: 'service_role', regex: /service_role/g },
  { name: 're_<token>', regex: /\bre_[A-Za-z0-9_]{16,}\b/g },
];

const results = {};
let totalMatches = 0;

for (const { name, regex } of patterns) {
  let count = 0;
  for (const file of files) {
    const content = fs.readFileSync(path.join(assetsDir, file), 'utf8');
    const matches = content.match(regex);
    if (matches) {
      count += matches.length;
    }
  }
  results[name] = count;
  totalMatches += count;
}

console.log(
  JSON.stringify(
    {
      jsFilesScanned: files.length,
      files,
      totalMatches,
      results,
    },
    null,
    2,
  ),
);

if (files.length === 0 || totalMatches > 0) {
  process.exit(1);
}
