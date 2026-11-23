import { describe, it, expect } from 'vitest';
import { buildExport, parseImport } from '../src/lib/backup';
import { sealWithPassword } from '@core/common/crypto';
import { emptyPersonal } from '../src/lib/store';

describe('10절 19번: 내보내기·동기화 파일에 기본으로 Gemini 키·PAT 없음', () => {
  it('기본 내보내기에는 기기 비밀값이 없다', () => {
    const out = JSON.stringify(buildExport({ ...emptyPersonal(), watchlist: ['X'] }, { geminiKey: 'AIzaSECRET', pat: 'github_pat_SECRET' }, false));
    expect(out).not.toContain('AIzaSECRET'); expect(out).not.toContain('github_pat_SECRET');
  });
  it('사용자가 선택하면 포함', () => {
    const out = JSON.stringify(buildExport(emptyPersonal(), { geminiKey: 'AIzaSECRET', pat: 'p' }, true));
    expect(out).toContain('AIzaSECRET');
  });
  it('동기화 대상(Personal)에는 Gemini 키·PAT 필드가 없다', () => {
    const keys = Object.keys(emptyPersonal());
    expect(keys).not.toContain('geminiKey'); expect(keys).not.toContain('pat');
  });
});

describe('내보내기 → 가져오기 왕복', () => {
  const p = { ...emptyPersonal(), watchlist: ['AAPL', '005930'] };
  it('암호 없음: 그대로 복원, 비밀값 없음', async () => {
    const r = await parseImport(JSON.stringify(buildExport(p, { geminiKey: 'g', pat: 't' }, false)), '');
    expect(r.personal.watchlist).toEqual(['AAPL', '005930']); expect(r.secrets).toBeNull();
  });
  it('암호 있음: 맞는 암호로 복원(비밀값 포함 선택 시 함께), 평문에 내용 없음', async () => {
    const env = await sealWithPassword('백업암호!', buildExport(p, { geminiKey: 'AIzaX', pat: 'patY' }, true));
    const raw = JSON.stringify(env);
    expect(raw).not.toContain('AAPL'); expect(raw).not.toContain('AIzaX');
    const r = await parseImport(raw, '백업암호!');
    expect(r.personal.watchlist).toEqual(['AAPL', '005930']); expect(r.secrets).toEqual({ geminiKey: 'AIzaX', pat: 'patY' });
  }, 30_000);
  it('틀린 암호·암호 누락·다른 파일은 거부', async () => {
    const raw = JSON.stringify(await sealWithPassword('a', buildExport(p, { geminiKey: null, pat: null }, false)));
    await expect(parseImport(raw, 'b')).rejects.toThrow('암호가 틀렸거나');
    await expect(parseImport(raw, '')).rejects.toThrow('파일 암호를 입력');
    await expect(parseImport('{"x":1}', '')).rejects.toThrow('백업 파일이 아닙니다');
  }, 30_000);
});
