// Syntax-only browser script check. Does not claim visual or device verification.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const html = readFileSync(new URL('../receiver/viewer.html', import.meta.url), 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
if (scripts.length !== 1) throw new Error('Expected one diagnostic viewer script');
new vm.Script(scripts[0][1]);
console.log('PASS: viewer JavaScript syntax (no browser/device execution)');

