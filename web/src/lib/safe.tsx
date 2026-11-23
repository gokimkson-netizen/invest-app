// XSS 방어(3-5): 외부 텍스트는 텍스트로만 렌더링. 마크다운이 필요하면 marked → DOMPurify를 거친다. raw HTML 직접 삽입 금지.
import { marked } from 'marked';
import DOMPurify from 'dompurify';
export function sanitizeMarkdown(md: string): string {
  const html = marked.parse(md, { async: false, gfm: true }) as string;
  return DOMPurify.sanitize(html, { ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'code', 'pre', 'blockquote', 'hr', 'a'], ALLOWED_ATTR: ['href'], ALLOWED_URI_REGEXP: /^https?:\/\//i });
}
/** 새니타이저를 거친 HTML만 받는 유일한 출구 */
export function Markdown({ md }: { md: string }) {
  return <div class="md" dangerouslySetInnerHTML={{ __html: sanitizeMarkdown(md) }} />;
}
/** 외부 링크는 http(s)만, 새 창·리퍼러 없음 */
export function ExtLink({ href, children }: { href: string; children: any }) {
  const ok = /^https?:\/\//i.test(href);
  return ok ? <a href={href} target="_blank" rel="noopener noreferrer nofollow">{children}</a> : <span>{children}</span>;
}
