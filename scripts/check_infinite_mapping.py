"""[로컬 전용] 10절 9번: 규칙 파일(private/infinite_v4.rules.json)과 대응표(private/infinite-v4-mapping.md)의 규칙 ID가 하나도 빠짐없이 일치하는지 검사.
원본이 없으면 '보류'로 기록한다. 결과에는 원본 해시·실행 시각만 남기고 내용은 남기지 않는다."""
import hashlib
import json
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main():
    rules, mapping = ROOT / "private/infinite_v4.rules.json", ROOT / "private/infinite-v4-mapping.md"
    now = datetime.now(timezone.utc).isoformat()
    if not rules.exists() or not mapping.exists():
        print(json.dumps({"상태": "보류", "사유": "무한매수법 V4.0 문서·규칙 파일 미제공", "실행시각": now}, ensure_ascii=False))
        return 0
    ids_r = {r["규칙ID"] for r in json.loads(rules.read_text(encoding="utf-8"))["규칙"]}
    ids_m = set(re.findall(r"\b(R-[A-Za-z0-9_-]+)\b", mapping.read_text(encoding="utf-8")))
    ok = ids_r == ids_m
    # 문서 예시 테스트(로컬 전용): private/*.test.ts
    ex = {"상태": "보류", "사유": "예시 테스트 파일 없음"}
    if (ROOT / "private/vitest.private.config.ts").exists():
        out = ROOT / "tests/.private-vitest.json"
        r = subprocess.run(["npx", "vitest", "run", "--config", "private/vitest.private.config.ts", "--reporter=json", f"--outputFile={out}"], cwd=ROOT, capture_output=True, text=True, timeout=600)
        try:
            j = json.loads(out.read_text())
            ex = {"상태": "통과" if r.returncode == 0 else "실패", "통과": j.get("numPassedTests"), "전체": j.get("numTotalTests")}
        except Exception:
            ex = {"상태": "실패", "사유": "결과 파일 없음"}
        out.unlink(missing_ok=True)
    # 원본 문서 해시: 규칙 파일이 어느 문서 판에서 옮겨졌는지 확인(10절 20번)
    rj = json.loads(rules.read_text(encoding="utf-8"))
    src = ROOT / rj.get("원본문서", "private/infinite.pdf")
    src_hash = hashlib.sha256(src.read_bytes()).hexdigest() if src.exists() else None
    same = src_hash is not None and src_hash == rj.get("원본해시")
    allok = ok and ex.get("상태") == "통과" and same
    print(json.dumps({"상태": "일치" if allok else "불일치", "규칙ID": {"규칙파일만": sorted(ids_r - ids_m), "대응표만": sorted(ids_m - ids_r), "개수": len(ids_r)},
                      "문서예시테스트": ex, "원본문서해시": src_hash, "규칙파일의원본해시일치": same,
                      "규칙파일해시": hashlib.sha256(rules.read_bytes()).hexdigest(), "대응표해시": hashlib.sha256(mapping.read_bytes()).hexdigest(), "실행시각": now}, ensure_ascii=False))
    return 0 if allok else 1


if __name__ == "__main__":
    sys.exit(main())
