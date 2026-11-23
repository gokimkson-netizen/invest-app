"""저장소 자체 검사(10절 4·9·14번 등). CI와 로컬에서 실행한다.

1) 전체 git 이력 + 작업 트리 + 빌드 결과물(site/·web/dist/)에서 비밀값·개인 정보 패턴 검색
   - 이메일(허용 목록 제외), Google API 키, GitHub 토큰, 개인 키, 'DATA_KEY=' 같은 할당, private/ 파일명
2) private/ 파일이 추적되지 않음, .gitignore에 private/ 있음
3) README·안내문 명령어의 띄어쓰기가 모두 '_'로 표기됨(코드 블록 안에 공백 없음)
4) 공개 Core 코드·주석·테스트에 규칙 값·문서 원문이 없음(private/ 원본이 있으면 문장 단위 대조)
5) 포크 PR로 Secrets가 새지 않음(pull_request_target 미사용, 비밀값 쓰는 워크플로는 schedule·workflow_dispatch만)
6) 워크플로 cron이 설계값과 일치(10절 21번 YAML 검사)
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ALLOW_EMAIL = re.compile(r"(noreply@anthropic\.com|41898282\+github-actions\[bot\]@users\.noreply\.github\.com|@example\.com|@users\.noreply\.github\.com)$")
PATTERNS = {
    "이메일": re.compile(r"[A-Za-z0-9][A-Za-z0-9._%+-]*@[A-Za-z0-9-]+\.[A-Za-z0-9.-]*[A-Za-z]{2,}"),
    "Google API 키": re.compile(r"AIza[0-9A-Za-z_\-]{35}"),
    "GitHub 토큰": re.compile(r"\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b|github_pat_[A-Za-z0-9_]{60,}"),
    "개인 키": re.compile(r"-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    "비밀값 할당": re.compile(r"(?i)\b(DATA_KEY|OPENDART_KEY|FRED_KEY|ECOS_KEY|GEMINI_API_KEY|STOOQ_APIKEY|TIINGO_TOKEN|ACCESS_TOKEN)\s*[=:]\s*['\"]?[A-Za-z0-9+/_\-]{16,}"),
    "crtfc_key 값": re.compile(r"crtfc_key=[0-9a-f]{40}"),
}
SKIP_DIRS = {"node_modules", ".git", "test-results", "playwright-report", "__pycache__"}
TEXT_EXT = {".ts", ".tsx", ".js", ".mjs", ".py", ".json", ".md", ".yml", ".yaml", ".toml", ".html", ".css", ".txt", ".csv"}
fails: list[str] = []


def scan_text(label: str, text: str) -> None:
    for name, p in PATTERNS.items():
        for m in p.finditer(text):
            s = m.group(0)
            if name == "이메일" and (ALLOW_EMAIL.search(s) or s.endswith((".png", ".svg"))):
                continue
            if name == "이메일" and re.search(r"@\d|@[A-Za-z]+\.(ts|js|json|md)$", s):
                continue
            fails.append(f"[{name}] {label}: {s[:12]}…")


def files(base: Path):
    for p in base.rglob("*"):
        if any(part in SKIP_DIRS for part in p.parts) or not p.is_file():
            continue
        if p.suffix in TEXT_EXT and p.stat().st_size < 5_000_000:
            yield p


def main() -> int:
    # 1) 작업 트리·빌드 결과물
    tracked = subprocess.run(["git", "ls-files"], cwd=ROOT, capture_output=True, text=True).stdout.split()
    # 아직 추적되지 않았지만 git add 하면 올라갈 새 파일(.gitignore 제외분 빼고)도 업로드 전에 검사
    untracked = subprocess.run(["git", "ls-files", "--others", "--exclude-standard"], cwd=ROOT, capture_output=True, text=True).stdout.split()
    if not tracked and not untracked:  # git 저장소가 아니면(압축 풀기 직후 등) .gitignore 대상 폴더를 뺀 전체
        untracked = [str(p.relative_to(ROOT)) for p in files(ROOT) if not any(part in {"private", "work", "site", "_data", "test-results"} for part in p.relative_to(ROOT).parts)]
    tracked = sorted(set(tracked) | set(untracked))
    for rel in tracked:
        p = ROOT / rel
        if p.exists() and p.suffix in TEXT_EXT:
            scan_text(rel, p.read_text(encoding="utf-8", errors="ignore"))
    for d in ("site", "web/dist", "tests/.fixture_site"):
        if (ROOT / d).exists():
            for p in files(ROOT / d):
                scan_text(str(p.relative_to(ROOT)), p.read_text(encoding="utf-8", errors="ignore"))
    # 전체 git 이력(모든 브랜치)
    hist = subprocess.run(["git", "log", "--all", "-p", "--no-color"], cwd=ROOT, capture_output=True, text=True, errors="ignore").stdout
    scan_text("git 이력", hist)
    names = subprocess.run(["git", "log", "--all", "--name-only", "--pretty=format:"], cwd=ROOT, capture_output=True, text=True).stdout.split()
    if any(n.startswith("private/") for n in names + tracked):
        fails.append("[개인 자료] private/ 파일이 커밋 이력에 있음")
    # 2) .gitignore
    gi = (ROOT / ".gitignore").read_text(encoding="utf-8")
    if not re.search(r"^private/$", gi, re.M):
        fails.append("[개인 자료] .gitignore에 private/ 없음")
    # 3) 명령어 표기
    for doc in ["README.md", *[str(p.relative_to(ROOT)) for p in (ROOT / "docs").glob("*guide*.md")]]:
        t = (ROOT / doc).read_text(encoding="utf-8") if (ROOT / doc).exists() else ""
        for blk in re.findall(r"```(?:cmd|bash|sh|text)?\n([\s\S]*?)```", t):
            for ln in blk.splitlines():
                if ln.strip() and " " in ln.strip():
                    fails.append(f"[명령어 표기] {doc}: 띄어쓰기를 '_'로 표기하지 않음 → {ln.strip()[:40]}")
        # 인라인 코드(`...`)도 띄어쓰기 없이(코드 블록 밖, 한 줄 안에서만 짝을 맞춤)
        body = re.sub(r"```[\s\S]*?```", "", t)
        for ln in body.splitlines():
            for span in re.findall(r"`([^`\n]+)`", ln):
                if " " in span:
                    fails.append(f"[명령어 표기] {doc}: 인라인 코드에 띄어쓰기 → `{span[:40]}`")
    # 4-b) 규칙 파일의 값(필드: 값 쌍)이 공개 파일에 없음(Core·테스트·웹·문서·설정)
    rf = ROOT / "private/infinite_v4.rules.json"
    if rf.exists():
        pub = [p for p in files(ROOT) if not any(x in p.relative_to(ROOT).parts for x in ("private", "work", "site", "tests", "web")) or p.relative_to(ROOT).parts[:2] == ("web", "src")]
        pub = [p for p in pub if p.suffix in {".ts", ".tsx", ".md", ".json", ".py"} and "node_modules" not in p.parts and p.name != "package-lock.json"]
        texts = {str(p.relative_to(ROOT)): p.read_text(encoding="utf-8", errors="ignore") for p in pub}
        for r in json.loads(rf.read_text(encoding="utf-8")).get("규칙", []):
            for k, v in r.items():
                if k in ("규칙ID", "문서쪽번호", "종류", "분할수") or not isinstance(v, (int, float)) or isinstance(v, bool):
                    continue
                pat = re.compile(r"['\"]?" + re.escape(k) + r"['\"]?\s*:\s*" + re.escape(str(v)) + r"(?![\d.])")
                for rel, t in texts.items():
                    if pat.search(t):
                        fails.append(f"[규칙 값] 공개 파일 {rel}에 규칙 값 '{k}: {v}'(규칙 {r.get('규칙ID')})")
    # 4) Core에 규칙 값·문서 원문 없음
    core = "\n".join(p.read_text(encoding="utf-8") for p in (ROOT / "packages/core/src/infinite").glob("*.ts"))
    core += "\n".join(p.read_text(encoding="utf-8") for p in (ROOT / "packages/core/test").glob("*.ts"))
    priv = ROOT / "private"
    if priv.exists():
        for p in priv.rglob("*"):
            if p.is_file() and p.suffix in {".md", ".txt", ".json"}:
                for sent in re.split(r"[\n.。]", p.read_text(encoding="utf-8", errors="ignore")):
                    s = sent.strip()
                    if len(s) >= 20 and s in core:
                        fails.append(f"[규칙 원문] 공개 Core에 private 원문 문장이 있음: {s[:20]}…")
    # 5) 워크플로
    for wf in (ROOT / ".github/workflows").glob("*.yml"):
        y = wf.read_text(encoding="utf-8")
        if "pull_request_target" in y:
            fails.append(f"[워크플로] {wf.name}: pull_request_target 사용")
        if "secrets." in y and re.search(r"^\s*(pull_request|push):", y, re.M):
            fails.append(f"[워크플로] {wf.name}: 비밀값을 쓰는데 push/PR로 실행됨")
        if re.search(r"set -x|ACTIONS_STEP_DEBUG|ACTIONS_RUNNER_DEBUG", y):
            fails.append(f"[워크플로] {wf.name}: 디버그 로깅 사용")
    # 6) cron 값
    want = {"news.yml": "7 * * * *", "daily-us.yml": "17 23 * * 1-5", "daily-kr.yml": "17 9 * * 1-5"}
    for f, c in want.items():
        y = (ROOT / ".github/workflows" / f).read_text(encoding="utf-8")
        if f == "news.yml":  # README '뉴스 수집 간격 바꾸기'대로 분 목록만 바꾸는 것은 허용(정각 0분 금지)
            m = re.search(r"cron: '(\d{1,2}(?:,\d{1,2})*) \* \* \* \*'", y)
            if not m or any(int(x) == 0 or int(x) > 59 for x in m.group(1).split(",")):
                fails.append(f"[cron] {f}: '분목록 * * * *' 형식(정각 0분 제외)이 아님")
        elif f"cron: '{c}'" not in y:
            fails.append(f"[cron] {f}: 설계값 '{c}'과 다름")
    # 6-b) 워크플로 YAML 문법(배포 전에 잡기: GitHub는 문법 오류 파일을 아예 실행하지 않음)
    import yaml
    for f in sorted((ROOT / ".github").rglob("*.yml")):
        try:
            d = yaml.safe_load(f.read_text(encoding="utf-8"))
            if f.parent.name == "workflows" and not (isinstance(d, dict) and "jobs" in d and (True in d or "on" in d)):
                fails.append(f"[YAML] {f.relative_to(ROOT)}: jobs/on 없음")
        except yaml.YAMLError as e:
            fails.append(f"[YAML] {f.relative_to(ROOT)}: 문법 오류 {str(e).splitlines()[0]}")
    # 7) 동시 실행 방지(10절 27번): 수집 잡은 워크플로마다 다른 그룹, publish는 공통 그룹 + queue: max, 취소 없음
    groups = set()
    for f in want:
        y = (ROOT / ".github/workflows" / f).read_text(encoding="utf-8")
        m = re.search(r"collect:[\s\S]*?group: ([\w-]+)\n\s*cancel-in-progress: false", y)
        if not m:
            fails.append(f"[concurrency] {f}: 수집 잡 그룹/cancel-in-progress: false 없음")
        else:
            groups.add(m.group(1))
        if not re.search(r"publish:[\s\S]*?group: publish\n\s*cancel-in-progress: false\n\s*queue: max", y):
            fails.append(f"[concurrency] {f}: publish 공통 그룹·queue: max 없음")
        if re.search(r"^permissions:\s*\n((?:\s+.+\n)+)", y, re.M):
            perms = re.search(r"^permissions:\s*\n((?:\s+.+\n)+)", y, re.M).group(1)
            if set(re.findall(r"(\S+):", perms)) != {"contents", "pages", "id-token"}:
                fails.append(f"[권한] {f}: contents·pages·id-token 외 권한")
    # 8) 비밀값 최소 권한: 수집 단계에는 그 잡이 쓰는 비밀값만, DATA_KEY는 확인·복호화·암호화 단계에만
    need = {"daily-us.yml": {"SEC_USER_AGENT", "WIKI_USER_AGENT", "FRED_KEY", "GEMINI_API_KEY", "STOOQ_APIKEY", "TIINGO_TOKEN"},
            "daily-kr.yml": {"OPENDART_KEY", "ECOS_KEY", "STOOQ_APIKEY"},
            "news.yml": {"SEC_USER_AGENT", "OPENDART_KEY", "FRED_KEY"}}
    for f, keys in need.items():
        y = (ROOT / ".github/workflows" / f).read_text(encoding="utf-8")
        m = re.search(r"- name: 수집\n\s+env:\n((?:\s{10}.+\n)+)", y)
        got = set(re.findall(r"secrets\.(\w+)", m.group(1))) if m else set()
        if got != keys:
            fails.append(f"[비밀값] {f}: 수집 단계 비밀값 {sorted(got)} ≠ 필요 {sorted(keys)}")
        for st in re.split(r"\n\s+- ", y):
            if "secrets.DATA_KEY" in st and not re.search(r"name: (필수 비밀값 확인|이전 상태 복호화|암호화)", st):
                fails.append(f"[비밀값] {f}: DATA_KEY가 확인·복호화·암호화 외 단계에 전달됨")
        if "continue-on-error: true" in y and "ref: data" in y.split("continue-on-error: true")[1][:80]:
            fails.append(f"[data 브랜치] {f}: checkout 실패를 무시함(직전 데이터 유실 위험)")
    if len(groups) != len(want):
        fails.append("[concurrency] 수집 잡 그룹이 워크플로마다 다르지 않음")
    if fails:
        print("검사 실패:")
        for f in fails[:200]:
            print(" -", f)
        return 1
    print(f"검사 통과: 추적 파일 {len(tracked)}개, 이력·빌드 결과물 포함")
    return 0


if __name__ == "__main__":
    sys.exit(main())
