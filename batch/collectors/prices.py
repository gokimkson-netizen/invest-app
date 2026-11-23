"""가격 수집(D17): 주 출처 Stooq(C급), 미국 보조 Tiingo(B급, 무료 시간당 50건 → 실행당 상한).

- 수정주가 사용(D3). 받을 수 있는 최대 기간(D5): 첫 수집은 전체, 이후 최근 구간만 받아 병합.
- 응답은 파싱하지 않고 원본 그대로 Node 계산 CLI에 넘기기 위해… 가 아니라, CSV/JSON → bars 변환만 파이썬에서 하지 않는다.
  변환은 공용 TS 파서(parseStooqCsv/parseTiingo)가 하므로 여기서는 원문을 raw/prices_src 에 저장한다.
"""
from __future__ import annotations

import time
from datetime import date, timedelta
from pathlib import Path

from batch.common.core import Failures, Http, config, env, log, read_json, safe, write_json


def stooq_symbol(u: dict) -> str | None:
    if u.get("stooq"):
        return u["stooq"]
    if u["market"] == "US":
        return u["ticker"].lower().replace(".", "-") + ".us"
    if u["market"] == "KR":
        return u["ticker"] + ".kr"  # Stooq 국내 지원 여부 미확인 — 실패 시 '데이터 없음(출처 미지원)'
    return None


def last_bar_date(prev: Path, u: dict) -> tuple[str | None, bool]:
    mkt = "kr" if u["market"] == "KR" else "us"
    o = read_json(prev / f"data/m3/{mkt}/sym/{safe(u['ticker'])}.json") or {}
    bars = o.get("bars") or []
    return (bars[-1][0] if bars else None), bool(o.get("needFull"))


def collect(uni: list[dict], prev: Path, raw: Path, fails: Failures, http_stooq: Http | None = None, http_tiingo: Http | None = None,
            stooq_cap: int = 3000, tiingo_cap: int = 40) -> dict:
    """원문 저장: raw/prices_src/{mkt}/{safe}.{csv|json} + meta. Node CLI가 파싱한다."""
    key, tok = env("STOOQ_APIKEY"), env("TIINGO_TOKEN")
    stooq_dead, n_stooq, n_tiingo, done = False, 0, 0, 0
    if not key:
        fails.add("가격", "Stooq", "STOOQ_APIKEY 없음")
    for u in uni:
        mkt = "kr" if u["market"] == "KR" else "us"
        last, need_full = last_bar_date(prev, u)
        full = not last or need_full
        d1 = "19000101" if full else (date.fromisoformat(last) - timedelta(days=10)).strftime("%Y%m%d")
        base = raw / "prices_src" / mkt / safe(u["ticker"])
        got = False
        sym = stooq_symbol(u)
        if key and sym and not stooq_dead and n_stooq < stooq_cap and http_stooq:
            n_stooq += 1
            txt, err = http_stooq.get("https://stooq.com/q/d/l/", params={"s": sym, "i": "d", "d1": d1, "d2": date.today().strftime("%Y%m%d"), "apikey": key})
            if txt and "Exceeded the daily hits limit" in txt:
                stooq_dead = True
                fails.add("가격", "Stooq", "일일 한도 초과 — 남은 종목은 보조 출처 또는 다음 실행")
            elif txt and txt.lstrip().lower().startswith("date"):
                base.parent.mkdir(parents=True, exist_ok=True)
                base.with_suffix(".csv").write_text(txt, encoding="utf-8")
                write_json(base.with_suffix(".meta.json"), {"ticker": u["ticker"], "source": "Stooq", "grade": "C", "format": "stooq", "full": full})
                got = True
            else:
                if err:
                    fails.add("가격", u["ticker"], "Stooq: " + err)
        if not got and u["market"] == "US" and tok and http_tiingo and n_tiingo < tiingo_cap:
            n_tiingo += 1
            start = "1960-01-01" if full else (date.fromisoformat(last) - timedelta(days=10)).isoformat()
            txt, err = http_tiingo.get(f"https://api.tiingo.com/tiingo/daily/{u['ticker'].lower().replace('.', '-')}/prices",
                                       params={"startDate": start, "resampleFreq": "daily"}, headers={"Authorization": f"Token {tok}"})
            if txt and txt.lstrip().startswith("["):
                base.parent.mkdir(parents=True, exist_ok=True)
                base.with_suffix(".json").write_text(txt, encoding="utf-8")
                write_json(base.with_suffix(".meta.json"), {"ticker": u["ticker"], "source": "Tiingo", "grade": "B", "format": "tiingo", "full": full})
                got = True
            elif err:
                fails.add("가격", u["ticker"], "Tiingo: " + err)
            time.sleep(0.2)
        if not got:
            write_json(base.with_suffix(".meta.json"), {"ticker": u["ticker"], "source": None, "grade": None, "format": None, "full": full,
                                                        "error": "데이터 없음(출처 미지원 또는 한도)" if u["market"] != "KR" else "데이터 없음(Stooq 국내 미지원 가능성)"})
        else:
            done += 1
    log(f"가격 수집: 성공 {done}/{len(uni)} (Stooq {n_stooq}회, Tiingo {n_tiingo}회)")
    return {"stooq_calls": n_stooq, "tiingo_calls": n_tiingo, "ok": done}
