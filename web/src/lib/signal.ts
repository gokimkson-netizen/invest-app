// 아주 작은 반응형 신호(외부 라이브러리 없이). useSignal로 컴포넌트를 다시 그린다.
import { useEffect, useState } from 'preact/hooks';
export interface Signal<T> { value: T; subscribe(f: () => void): () => void }
export function signal<T>(v: T): Signal<T> {
  let cur = v; const subs = new Set<() => void>();
  return {
    get value() { return cur; },
    set value(n: T) { cur = n; subs.forEach((f) => f()); },
    subscribe(f) { subs.add(f); return () => subs.delete(f); },
  };
}
export function useSignal<T>(s: Signal<T>): T {
  const [, set] = useState(0);
  useEffect(() => s.subscribe(() => set((x) => x + 1)), [s]);
  return s.value;
}
