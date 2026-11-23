import json
import os
from pathlib import Path

import pytest

from batch.common.core import Failures, RateLimiter, mask, read_json, write_json
from batch.collectors import prices
from batch import summarize

ROOT = Path(__file__).resolve().parents[2]


def test_mask_hides_keys_emails_urls(monkeypatch):
    monkeypatch.setenv("OPENDART_KEY", "abcdef1234567890")
    monkeypatch.setenv("SEC_USER_AGENT", "Kim kim@example.com")
    s = mask("GET https://opendart.fss.or.kr/api/list.json?crtfc_key=abcdef1234567890 by kim@example.com api_key=zzz ecos StatisticSearch/ECOSKEY123/json")
    assert "abcdef1234567890" not in s and "kim@example.com" not in s and "zzz" not in s and "ECOSKEY123" not in s and "https://" not in s


def test_sec_rate_limiter_max_10_per_sec():
    t = [0.0]
    lim = RateLimiter(8.0, clock=lambda: t[0], sleep=lambda d: t.__setitem__(0, t[0] + d))
    stamps = []
    for _ in range(50):
        lim.wait()
        stamps.append(t[0])
    for i in range(len(stamps)):
        assert sum(1 for x in stamps if stamps[i] <= x < stamps[i] + 1.0) <= 10  # 어떤 1초 창에도 10건 이하


class FakeResp:
    def __init__(self, text, err=None):
        self.text, self.err = text, err


class FakeHttp:
    def __init__(self, table):
        self.table, self.calls = table, []

    def get(self, url, params=None, headers=None, binary=False):
        self.calls.append((url, dict(params or {})))
        sym = (params or {}).get("s") or url
        v = self.table.get(sym)
        if isinstance(v, Exception):
            raise v
        return v if v is not None else (None, "없음(404)")


CSV = "Date,Open,High,Low,Close,Volume\n2026-11-19,1,1,1,10,5\n2026-11-20,1,1,1,11,5\n"


def test_one_symbol_failure_does_not_stop_others(tmp_path, monkeypatch):
    monkeypatch.setenv("STOOQ_APIKEY", "k")
    uni = [{"ticker": "AAA", "market": "US"}, {"ticker": "BAD", "market": "US"}, {"ticker": "CCC", "market": "US"}]
    http = FakeHttp({"aaa.us": (CSV, None), "bad.us": (None, "HTTP 500"), "ccc.us": (CSV, None)})
    f = Failures()
    r = prices.collect(uni, tmp_path / "prev", tmp_path / "raw", f, http, None)
    assert r["ok"] == 2
    assert (tmp_path / "raw/prices_src/us/CCC.csv").exists()
    assert any(x["대상"] == "BAD" for x in f.items)


def test_empty_state_full_history_then_incremental(tmp_path, monkeypatch):
    monkeypatch.setenv("STOOQ_APIKEY", "k")
    u = [{"ticker": "AAA", "market": "US"}]
    http = FakeHttp({"aaa.us": (CSV, None)})
    prices.collect(u, tmp_path / "empty", tmp_path / "raw", Failures(), http, None)
    assert http.calls[0][1]["d1"] == "19000101"  # data 브랜치가 비어 있으면 전체 기간
    write_json(tmp_path / "prev/data/m3/us/sym/AAA.json", {"bars": [["2026-11-20", 11]]})
    http2 = FakeHttp({"aaa.us": (CSV, None)})
    prices.collect(u, tmp_path / "prev", tmp_path / "raw2", Failures(), http2, None)
    assert http2.calls[0][1]["d1"] == "20261110"
    assert read_json(tmp_path / "raw2/prices_src/us/AAA.meta.json")["full"] is False


def test_stooq_daily_limit_stops_stooq(tmp_path, monkeypatch):
    monkeypatch.setenv("STOOQ_APIKEY", "k")
    uni = [{"ticker": t, "market": "US"} for t in ("A1", "A2", "A3")]
    http = FakeHttp({"a1.us": ("Exceeded the daily hits limit", None)})
    f = Failures()
    prices.collect(uni, tmp_path / "p", tmp_path / "r", f, http, None)
    assert len(http.calls) == 1 and any("한도" in x["사유"] for x in f.items)


class Post:
    def __init__(self, codes):
        self.codes, self.n = list(codes), 0

    def __call__(self, url, headers=None, json=None, timeout=None):
        self.n += 1
        assert "key=" not in url and headers["x-goog-api-key"] == "g"  # 키는 헤더로
        code = self.codes.pop(0) if self.codes else 200

        class R:
            status_code = code

            def json(self_inner):
                import json as j
                return {"candidates": [{"content": {"parts": [{"text": j.dumps({"요약": "매출은 100이다."})}]}}]}
        return R()


def _setup_filings(raw, n):
    uni = []
    for i in range(n):
        t = f"T{i}"
        uni.append({"ticker": t, "m1": True})
        write_json(raw / "sec" / t / "filings.json", {"10-K": {"accession": f"0000-{i}"}})
        (raw / "sec" / t / "item1.txt").write_text("Item 1. Business 매출은 100이다.", encoding="utf-8")
    return uni


def test_summary_queue_cap_and_resume_multi_day(tmp_path, monkeypatch):
    """하루 상한까지만 → 다음 날(새 raw 폴더, 수집기는 같은 공시를 다시 받지 않음)에도 대기열이 이어서 처리됨"""
    monkeypatch.setenv("GEMINI_API_KEY", "g")
    monkeypatch.setattr(summarize, "numcheck", lambda s, src: {"오류": 0})
    cfg = json.loads((ROOT / "config/llm.json").read_text(encoding="utf-8"))
    cfg["batch"]["summary_daily_cap"] = 2
    monkeypatch.setattr(summarize, "config", lambda n: cfg)
    import shutil
    raw1 = tmp_path / "day1/raw"
    uni = _setup_filings(raw1, 5)
    st = summarize.run(uni, tmp_path / "day1/prev", raw1, tmp_path / "day1/out/state/summaries", Failures(), post=Post([]), sleep=lambda s: None)
    assert st["이번처리"] == 2 and st["대기"] == 3
    for day in (2, 3):
        prev = tmp_path / f"day{day}/prev"
        shutil.copytree(tmp_path / f"day{day-1}/out/state", prev / "state")
        write_json(prev / "state/summaries/count.json", {})  # 다음 날(태평양시) → 사용량 초기화
        raw = tmp_path / f"day{day}/raw"  # 새 raw: filings.json만 있고 원문(item1.txt)은 다시 받지 않음
        for u in uni:
            write_json(raw / "sec" / u["ticker"] / "filings.json", read_json(raw1 / "sec" / u["ticker"] / "filings.json"))
        p = Post([])
        st = summarize.run(uni, prev, raw, tmp_path / f"day{day}/out/state/summaries", Failures(), post=p, sleep=lambda s: None)
        assert p.n == min(2, 5 - 2 * (day - 1))
    assert st["대기"] == 0
    assert len(list((tmp_path / "day3/out/state/summaries/done").glob("*.json"))) == 5


def test_summary_429_no_retry_loop(tmp_path, monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "g")
    monkeypatch.setattr(summarize, "numcheck", lambda s, src: {})
    raw = tmp_path / "raw"
    uni = _setup_filings(raw, 3)
    p = Post([429])
    st = summarize.run(uni, tmp_path / "prev", raw, tmp_path / "o", Failures(), post=p, sleep=lambda s: None)
    assert p.n == 1 and st["중단사유"] and st["대기"] == 3


def test_publish_replaces_only_owned_paths(tmp_path):
    import importlib.util
    spec = importlib.util.spec_from_file_location("publish", ROOT / "scripts/publish.py")
    pub = importlib.util.module_from_spec(spec); spec.loader.exec_module(pub)
    data, inc = tmp_path / "data", tmp_path / "inc"
    write_json(data / "data/m1/index.json", {"old": 1})
    write_json(data / "data/m3/us/index.json", {"keep": 1})
    write_json(inc / "data/m6/cards.json", {"new": 1})
    pub.apply_owned("news", inc, data)
    assert read_json(data / "data/m1/index.json") == {"old": 1}  # 뉴스 배포 후에도 M1·M3 데이터 유지
    assert read_json(data / "data/m3/us/index.json") == {"keep": 1}
    assert read_json(data / "data/m6/cards.json") == {"new": 1}


def test_krx_not_implemented():
    src = "\n".join(p.read_text(encoding="utf-8") for p in (ROOT / "batch").rglob("*.py") if "tests" not in p.parts)
    assert "KRX_ID" not in src and "KRX_PW" not in src and "data.krx.co.kr" not in src
