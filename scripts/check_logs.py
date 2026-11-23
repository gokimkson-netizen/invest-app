"""10절 5번: Actions 로그를 내려받아 키·이메일·요청 URL이 없는지 검사.
사용: GitHub 웹 → Actions → 실행 → 오른쪽 위 ⋯ → Download log archive → 압축 해제한 폴더를 인자로.
  python scripts/check_logs.py <로그폴더>
--selftest: 가짜 비밀값을 넣고 배치를 실제로 돌려(외부 접속 실패) 출력에 비밀값·URL이 없는지 확인."""
import os
import re
import subprocess
import sys
from pathlib import Path

PAT = [re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"), re.compile(r"https?://(?!github\.com/actions)[^\s'\"]+"),
       re.compile(r"(?i)(crtfc_key|api_key|apikey|token)=\S+"), re.compile(r"AIza[0-9A-Za-z_\-]{20,}")]
ALLOW = re.compile(r"(github\.com|githubusercontent\.com|actions/|nodejs\.org|pypi\.org|npmjs|41898282\+github-actions)")


def scan(text: str, extra: list[str]) -> list[str]:
    bad = [v for v in extra if v and v in text]
    for p in PAT:
        bad += [m.group(0) for m in p.finditer(text) if not ALLOW.search(m.group(0))]
    return bad


def selftest() -> int:
    fake = {"SEC_USER_AGENT": "Tester leak-check-mail@example.com", "OPENDART_KEY": "a" * 40, "FRED_KEY": "b" * 32, "ECOS_KEY": "ECOSLEAK123",
            "GEMINI_API_KEY": "AIza" + "Q" * 35, "STOOQ_APIKEY": "stooqleak999", "TIINGO_TOKEN": "tiingoleak888", "DATA_KEY": "x"}
    env = {**os.environ, **fake}
    out = ""
    for job in ("us", "kr", "news"):
        r = subprocess.run([sys.executable, "-m", "batch.run", job, "--prev", "work/st/prev", "--raw", f"work/st/raw_{job}", "--out", "work/st/out", "--force"],
                           capture_output=True, text=True, env=env, timeout=900)
        out += r.stdout + r.stderr
        fail_file = Path(f"work/st/raw_{job}/collect_failures.json")
        if fail_file.exists():
            out += fail_file.read_text(encoding="utf-8")
    bad = scan(out, list(fake.values())[:-1])
    print(f"자가 검사: 출력 {len(out)}자, 노출 {len(bad)}건")
    for b in bad[:20]:
        print(" -", b[:16] + "…")
    return 1 if bad else 0


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--selftest":
        sys.exit(selftest())
    d = Path(sys.argv[1])
    found = []
    for p in d.rglob("*.txt"):
        found += scan(p.read_text(encoding="utf-8", errors="ignore"), [])
    print("노출 없음" if not found else f"노출 {len(found)}건: " + ", ".join(x[:16] for x in found[:20]))
    sys.exit(1 if found else 0)
