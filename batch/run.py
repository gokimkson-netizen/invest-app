"""배치 진입점. 사용: python -m batch.run <us|kr|news> --prev work/prev --raw work/raw --out work/out

단계마다 실패를 격리한다(4-3): 한 단계·한 종목 실패는 기록만 하고 다음으로 넘어간다.
휴장일에는 수집을 건너뛰고 '휴장'으로 표시한다(4-2).
"""
from __future__ import annotations

import argparse
import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path

from batch.common.core import Failures, Http, RateLimiter, ROOT, env, log, read_json, write_json
from batch.collectors import misc, prices, sec, universe
from batch import summarize


def market_status(market: str) -> dict:
    r = subprocess.run(["node", str(ROOT / "batch/calc/dist/cli.mjs"), "market-status", market], capture_output=True, text=True, timeout=30)
    try:
        return json.loads(r.stdout)
    except Exception:
        return {"휴장": False}


def step(fails: Failures, name: str, fn, *a, **kw):
    try:
        return fn(*a, **kw)
    except Exception as e:  # 실패 격리
        fails.add("배치", name, f"단계 실패: {type(e).__name__}: {e}")
        log(f"단계 실패(계속 진행): {name}")
        return None


def sec_http() -> Http:
    ua = env("SEC_USER_AGENT")  # "이름 이메일" 형식
    return Http(user_agent=ua or "invest-app (missing contact)", limiter=RateLimiter(8.0))


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("job", choices=["us", "kr", "news"])
    ap.add_argument("--prev", default="work/prev")
    ap.add_argument("--raw", default="work/raw")
    ap.add_argument("--out", default="work/out")
    ap.add_argument("--force", action="store_true", help="휴장일에도 실행")
    a = ap.parse_args(argv)
    prev, raw, out = Path(a.prev), Path(a.raw), Path(a.out)
    raw.mkdir(parents=True, exist_ok=True)
    fails = Failures()
    if a.job in ("us", "kr"):
        ms = market_status("US" if a.job == "us" else "KR")
        if ms.get("휴장") and not a.force:
            log(f"휴장({ms.get('사유')}) — 수집을 건너뜀")
            write_json(raw / "holiday.json", ms)
            fails.dump(raw)
            return 0
    if not env("SEC_USER_AGENT") and a.job != "kr":
        fails.add("SEC", "User-Agent", "SEC_USER_AGENT 비밀값 없음 — SEC 수집 생략")
    plain = Http(user_agent="invest-app-batch/1.0 (+github actions)", limiter=RateLimiter(4.0))
    dart = Http(limiter=RateLimiter(5.0))
    if a.job == "us":
        s = sec_http()
        tickers = step(fails, "SEC 티커 목록", sec.company_tickers, s, fails) or {} if env("SEC_USER_AGENT") else {}
        wua = universe.wiki_user_agent()
        wiki = Http(user_agent=wua, limiter=RateLimiter(1.0)) if wua else None  # 직렬·1초 간격
        uni = step(fails, "유니버스", universe.resolve, wiki, None, tickers, prev, "US", fails, out) or []
        write_json(raw / "universe.json", uni)
        step(fails, "가격", prices.collect, uni, prev, raw, fails, Http(limiter=RateLimiter(2.0)), Http(limiter=RateLimiter(0.8)))
        step(fails, "금리", misc.collect_rates_us, plain, raw, fails)
        if env("SEC_USER_AGENT"):
            for u in [x for x in uni if x.get("m1")]:
                step(fails, f"SEC {u['ticker']}", sec.collect_company, s, u, prev, raw, fails)
            titles = step(fails, "SEC 회사명", sec.company_titles, s) or {}
            step(fails, "버크셔 13F", sec.collect_berkshire, s, raw, uni, titles, fails)
        # 공시 발췌(공용 TS) → 요약(Gemini, 배치 키)
        subprocess.run(["node", str(ROOT / "batch/calc/dist/cli.mjs"), "excerpts", str(raw)], check=False, timeout=1800)
        step(fails, "공시 요약", summarize.run, uni, prev, raw, out / "state/summaries", fails)
    elif a.job == "kr":
        uni = step(fails, "유니버스", universe.resolve, plain, dart, {}, prev, "KR", fails, out) or []
        write_json(raw / "universe.json", uni)
        step(fails, "가격", prices.collect, uni, prev, raw, fails, Http(limiter=RateLimiter(2.0)), None)
        step(fails, "금리", misc.collect_rates_kr, plain, raw, fails)
        step(fails, "DART", misc.collect_dart_kr, dart, uni, prev, raw, fails)
    else:
        now = datetime.now(timezone.utc)
        rs = env("RUN_STARTED")  # 워크플로 첫 단계에서 기록한 시작 시각(설치 단계 시간 제외)
        try:
            started = datetime.fromisoformat(rs.replace("Z", "+00:00")) if rs else now
        except ValueError:
            started = now
        uni = (read_json(prev / "state/us/universe.json", []) or []) + (read_json(prev / "state/kr/universe.json", []) or [])
        write_json(raw / "universe.json", uni)
        manual = env("GITHUB_EVENT_NAME") == "workflow_dispatch"
        # 예정 시각 배정과 지연 계산은 공용 TS(assignRunSlots)가 이전 실행 기록과 함께 한다(60분 넘는 지연도 바르게 셈)
        write_json(raw / "runinfo.json", {"scheduled": None, "started": started.isoformat(), "manual": manual})
        step(fails, "뉴스", misc.collect_news, plain, sec_http(), dart, raw, fails)
    fails.dump(raw)
    log(f"수집 단계 종료: 실패 기록 {len(fails.items)}건")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
