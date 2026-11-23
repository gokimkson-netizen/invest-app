"""치명 결함 회귀 테스트: 분할·배당으로 과거 수정주가가 바뀌면 기준이 다른 봉을 섞지 않는다(D3)."""
import json
import subprocess
from pathlib import Path

from batch.common.core import Failures, read_json, write_json
from batch.collectors import prices

ROOT = Path(__file__).resolve().parents[2]
CLI = ["node", str(ROOT / "batch/calc/dist/cli.mjs")]


def test_split_detected_keeps_old_and_requests_full(tmp_path, monkeypatch):
    subprocess.run(["node", "scripts/build_cli.mjs"], cwd=ROOT, check=True, capture_output=True)
    prev, raw, out = tmp_path / "prev", tmp_path / "raw", tmp_path / "out"
    uni = [{"ticker": "SPL", "name": "Split Co", "market": "US", "kind": "stock", "indices": ["SP500"]}]
    write_json(raw / "universe.json", uni)
    old = [[f"2026-11-{d:02d}", 400.0, None, None, None] for d in range(2, 21) if d not in (7, 8, 14, 15)]
    write_json(prev / "data/m3/us/sym/SPL.json", {"bars": old, "출처": "Stooq", "등급": "C"})
    # 4:1 분할 후 새 수정주가 기준(과거도 100) — 증분 수집분과 겹치는 날짜의 값이 다름
    csv = "Date,Open,High,Low,Close,Volume\n" + "\n".join(f"2026-11-{d:02d},100,100,100,100,1" for d in (16, 17, 18, 19, 20, 23)) + "\n"
    (raw / "prices_src/us").mkdir(parents=True)
    (raw / "prices_src/us/SPL.csv").write_text(csv)
    write_json(raw / "prices_src/us/SPL.meta.json", {"ticker": "SPL", "source": "Stooq", "grade": "C", "format": "stooq", "full": False})
    subprocess.run(CLI + ["build-us", str(raw), str(prev), str(out)], check=True, capture_output=True)
    sym = read_json(out / "data/m3/us/sym/SPL.json")
    closes = {b[1] for b in sym["bars"]}
    assert closes == {400.0}  # 섞이지 않음(직전 일관 데이터 유지)
    assert sym["needFull"] is True and "전체 재수집" in sym["오류"]
    assert sym["현재낙폭"]["all"]["고점대비하락률%"] == 0  # 가짜 -75% 낙폭 없음
    # 다음 실행: 수집기가 전체 기간을 요청
    monkeypatch.setenv("STOOQ_APIKEY", "k")

    class H:
        calls = []
        def get(self, url, params=None, headers=None, binary=False):
            self.calls.append(params); return (csv, None)
    h = H()
    prices.collect(uni, out, tmp_path / "raw2", Failures(), h, None)
    assert h.calls[0]["d1"] == "19000101"
    assert read_json(tmp_path / "raw2/prices_src/us/SPL.meta.json")["full"] is True
