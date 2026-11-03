import assert from 'node:assert/strict';

import { sanitizeCsvValue } from '../public/assets/js/components.js';

const dangerous = [
  '=HYPERLINK("http://evil.example","click")',
  '+cmd',
  '@SUM(A1:A2)',
  '-cmd',
  '\t=1+1',
  '\r=1+1',
  '  =1+1',
];

for (const value of dangerous) {
  const cleaned = sanitizeCsvValue(value);
  assert.equal(cleaned, `'${value}`, `formula-like value was not neutralised: ${JSON.stringify(value)}`);
}

for (const value of ['normal', '-1', '-1.5', '-1e3', '  -42', 0, 42, null, undefined]) {
  const text = String(value ?? '');
  assert.equal(sanitizeCsvValue(value), text, `safe value was altered: ${JSON.stringify(value)}`);
}

console.log(`CSV safety: ${dangerous.length} dangerous values neutralised; safe values preserved.`);
