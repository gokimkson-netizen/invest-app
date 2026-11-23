"""배치 파이프라인 통합 테스트(합성 픽스처, 외부 접속 없음)."""
import base64
import json
import os
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
CLI = ["node", str(ROOT / "batch/calc/dist/cli.mjs")]


@pytest.fixture(scope="module")
def site(tmp_path_factory):
    subprocess.run(["node", "scripts/build_cli.mjs"], cwd=ROOT, check=True)
    if not (ROOT / "web/dist/index.html").exists():
        subprocess.run(["npm", "run", "build"], cwd=ROOT, check=True)
    out = tmp_path_factory.mktemp("fx") / "site"
    key = base64.b64encode(os.urandom(32)).decode()
    r = subprocess.run(["python3", "scripts/make_fixture.py", str(out), "--key", key], cwd=ROOT, check=True, capture_output=True, text=True)
    work = Path(json.loads(r.stdout.strip().splitlines()[-1])["work"])
    plain = out.parent / "plain"
    subprocess.run(CLI + ["unseal", str(work / "publish"), str(plain)], check=True, env={**os.environ, "DATA_KEY": key})
    return {"out": out, "work": work, "plain": plain, "key": key}


def rj(p):
    return json.loads(Path(p).read_text(encoding="utf-8"))


def test_empty_data_branch_rebuilds_everything(site):
    """10절 18번: 빈 상태(prev 없음)에서 처음부터 만들어 동작"""
    p = site["plain"]
    for f in ("data/m1/index.json", "data/m3/us/index.json", "data/m3/kr/index.json", "data/m6/cards.json", "data/shared/us/rates.json", "state/news/items.json"):
        assert (p / f).exists(), f
    assert rj(p / "data/m1/sym/TST.json")["정량판정"]["G2"] == "통과"


def test_public_files_are_ciphertext_except_status(site):
    d = site["out"] / "data"
    for f in d.rglob("*.json"):
        o = rj(f)
        rel = f.relative_to(site["out"]).as_posix()
        if rel.startswith("data/status/") or rel == "data/_status.json":
            assert "alg" not in o
        else:
            assert o.get("alg") == "A256GCM", rel
    txt = "\n".join(f.read_text(encoding="utf-8") for f in d.rglob("*.json"))
    assert "Testco" not in txt and "Federal Reserve" not in txt  # 시세·뉴스 원문이 평문으로 공개되지 않음


def test_failure_isolation_and_status(site):
    """10절 3번: 일부러 실패하는 종목(BAD)이 다른 종목·모듈을 멈추지 않음"""
    st = rj(site["out"] / "data/status/us.json")
    assert any(x["대상"] == "BAD" for x in st["실패"])
    assert st["성공"]["M3"] >= 4 and st["성공"]["M1"] >= 1 and st["기준일"] == "2026-11-20"


def test_news_retention_and_no_article_body(site):
    """10절 24·29번: 최근 N일치만, 기사 본문 저장 안 함(제목·출처·링크·시각·공식 요약만)"""
    items = rj(site["plain"] / "state/news/items.json")
    assert items and all("Old item" not in i["title"] for i in items)
    allowed = {"id", "title", "summary", "source", "domain", "grade", "url", "published", "kind", "market", "tickers"}
    for i in items:
        assert set(i) <= allowed and i["url"].startswith("https://")
        assert i["summary"] is None or len(i["summary"]) <= 500
    for c in rj(site["plain"] / "data/m6/cards.json")["cards"]:
        assert all(s["url"].startswith("https://") for s in c["출처목록"])


def test_news_run_delay_recorded(site):
    st = rj(site["out"] / "data/status/news.json")
    assert st["실행기록"]["최근지연_최대분"] is not None and "실측" in st["실행기록"]["지연측정"]


def test_summary_numcheck_warns_unknown_numbers(tmp_path):
    """10절 32번: 원문에 없는 숫자가 있으면 경고"""
    (tmp_path / "s.txt").write_text("매출은 1,234억원이며 영업이익률은 37.5%다.", encoding="utf-8")
    (tmp_path / "i.json").write_text(json.dumps({"원문": "Revenue was 123.4 billion won."}), encoding="utf-8")
    r = subprocess.run(CLI + ["numcheck", str(tmp_path / "s.txt"), str(tmp_path / "i.json")], capture_output=True, text=True, check=True)
    assert json.loads(r.stdout)["오류"] >= 1


def test_m1_summary_display(site):
    m = rj(site["plain"] / "data/m1/sym/TST.json")
    assert m["filings"]["item1"]["요약표시"] == "AI 요약" and m["filings"]["item1"]["발췌"]
    assert m["filings"]["proxy"]["요약표시"].startswith("AI 요약 없음")
    assert "<script" not in (m["filings"]["item1"]["발췌"] or "")
