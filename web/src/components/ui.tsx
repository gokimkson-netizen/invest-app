import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';

export function Card({ title, children, cls }: { title?: string; children: ComponentChildren; cls?: string }) {
  return <section class={`card ${cls ?? ''}`}>{title && <h2>{title}</h2>}{children}</section>;
}
export const Disclaimer = ({ text }: { text?: string }) => <p class="disclaimer">{text ?? '투자 권유가 아닌 참고 자료입니다.'}</p>;
export const Note = ({ children, kind }: { children: ComponentChildren; kind?: 'warn' | 'err' | 'info' }) => <div class={`note ${kind ?? 'info'}`} role={kind === 'err' ? 'alert' : undefined}>{children}</div>;
export const Badge = ({ children, cls }: { children: ComponentChildren; cls?: string }) => <span class={`badge ${cls ?? ''}`}>{children}</span>;

/** 비동기 로딩 훅 — 실패 사유를 그대로 보여 준다(날조 금지) */
export function useAsync<T>(f: () => Promise<T>, deps: unknown[]): { data: T | null; error: string | null; loading: boolean } {
  const [s, set] = useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: true });
  useEffect(() => {
    let alive = true;
    set((x) => ({ ...x, loading: true, error: null }));
    f().then((d) => alive && set({ data: d, error: null, loading: false }), (e) => alive && set({ data: null, error: String(e?.message ?? e), loading: false }));
    return () => { alive = false; };
  }, deps);
  return s;
}
export function Loading({ s }: { s: { loading: boolean; error: string | null } }) {
  if (s.loading) return <p class="muted">불러오는 중…</p>;
  if (s.error) return <Note kind="err">데이터 없음({s.error})</Note>;
  return null;
}
