// 배치 계산 CLI 번들(공용 TypeScript 모듈 포함) → batch/calc/dist/cli.mjs
import { build } from 'esbuild';
await build({ entryPoints: ['batch/calc/cli.ts'], bundle: true, platform: 'node', format: 'esm', target: 'node22', outfile: 'batch/calc/dist/cli.mjs', logLevel: 'warning' });
console.log('built batch/calc/dist/cli.mjs');
