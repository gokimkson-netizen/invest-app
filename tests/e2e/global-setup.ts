import { execSync } from 'node:child_process';
import fs from 'node:fs';
// 테스트용 사이트: 웹앱 빌드(가짜 Worker 주소) + 합성 픽스처 데이터(배치 파이프라인 전체를 거쳐 암호화)
export default function () {
  execSync('npm run build', { stdio: 'inherit', env: { ...process.env, WORKER_URL: 'https://relay.test' } });
  execSync('node scripts/build_cli.mjs', { stdio: 'inherit' });
  execSync('node tests/parity/build.mjs', { stdio: 'inherit' });
  const out = execSync('python3 scripts/make_fixture.py tests/.fixture_site').toString().trim().split('\n').pop()!;
  fs.writeFileSync('tests/.fixture_key.json', out);
}
