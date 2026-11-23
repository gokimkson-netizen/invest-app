import { build } from 'esbuild';
import fs from 'node:fs';
fs.mkdirSync('tests/.parity', { recursive: true });
await build({ entryPoints: ['tests/parity/entry.ts'], bundle: true, platform: 'node', format: 'esm', outfile: 'tests/.parity/node.mjs', logLevel: 'warning' });
await build({ stdin: { contents: "import { run } from './tests/parity/entry.ts'; window.__parity = run;", resolveDir: '.', loader: 'ts' }, bundle: true, platform: 'browser', format: 'iife', outfile: 'tests/.parity/browser.js', logLevel: 'warning' });
const { run } = await import(process.cwd() + '/tests/.parity/node.mjs');
fs.writeFileSync('tests/.parity/node.json', JSON.stringify(run()));
console.log('parity fixtures built');
