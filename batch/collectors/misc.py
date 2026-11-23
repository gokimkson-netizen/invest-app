"""금리(FRED·ECOS), OpenDART(국내 공시·실적), 뉴스(RSS·SEC 8-K·DART) 수집. 원문만 저장한다."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

from batch.common.core import Failures, Http, config, env, log, read_json, safe, write_json

FRED = "https://api.stlouisfed.org/fred/series/observations"


def fred_series(http: Http, sid: str, fails: Failures, limit: int | None = 10, desc: bool = True, realtime: bool = False) -> list[dict]:
    key = env("FRED_KEY")
    if not key:
        fails.add("금리", "FRED", "FRED_KEY 없음")
        return []
    params = {"series_id": sid, "api_key": key, "file_type": "json", "sort_order": "desc" if desc else "asc"}
    if limit:
        params["limit"] = limit
    j, err = http.get_json(FRED, params=params)
    if err:
        fails.add("금리", sid, "FRED: " + err)
        return []
    return [o for o in j.get("observations", []) if o.get("value") not in (".", None, "")]


def collect_rates_us(http: Http, raw: Path, fails: Failures) -> None:
    out = {"출처": "FRED", "등급": "A"}
    obs = fred_series(http, "DGS10", fails, limit=10)
    if obs:
        out["DGS10"] = {"value": float(obs[0]["value"]), "date": obs[0]["date"]}
    fx = fred_series(http, "DEXKOUS", fails, limit=None, desc=False)
    if fx:
        out["DEXKOUS"] = [[o["date"], float(o["value"])] for o in fx]
    if "DGS10" in out:
        write_json(raw / "rates.json", out)


def collect_rates_kr(http: Http, raw: Path, fails: Failures) -> None:
    key = env("ECOS_KEY")
    if not key:
        fails.add("금리", "ECOS", "ECOS_KEY 없음")
        return
    end = datetime.now(timezone.utc).strftime("%Y%m%d")
    start = (datetime.now(timezone.utc) - timedelta(days=20)).strftime("%Y%m%d")
    # 817Y002 시장금리(일별), 010210000 국고채(10년)
    j, err = http.get_json(f"https://ecos.bok.or.kr/api/StatisticSearch/{key}/json/kr/1/30/817Y002/D/{start}/{end}/010210000")
    if err:
        fails.add("금리", "국고채10년", "ECOS: " + err)
        return
    rows = (j or {}).get("StatisticSearch", {}).get("row", [])
    if not rows:
        fails.add("금리", "국고채10년", "ECOS 응답에 값 없음")
        return
    r = rows[-1]
    t = r["TIME"]
    write_json(raw / "rates_kr.json", {"KR10Y": {"value": float(r["DATA_VALUE"]), "date": f"{t[:4]}-{t[4:6]}-{t[6:8]}"}, "출처": "한국은행 ECOS", "등급": "A"})


def collect_dart_kr(http: Http, uni: list[dict], prev: Path, raw: Path, fails: Failures, cap: int = 3000) -> None:
    """국내 유니버스 M2: 최근 7일 공시 목록, 주요계정(분기 캐시)."""
    key = env("OPENDART_KEY")
    if not key:
        fails.add("M2", "OpenDART", "OPENDART_KEY 없음")
        return
    now = datetime.now(timezone.utc)
    bgn = (now - timedelta(days=7)).strftime("%Y%m%d")
    n = 0
    year = now.year - (1 if now.month < 4 else 0)
    for u in uni:
        cc = u.get("corp_code")
        if not cc or n >= cap:
            continue
        d = raw / "dart" / safe(u["ticker"])
        j, err = http.get_json("https://opendart.fss.or.kr/api/list.json", params={"crtfc_key": key, "corp_code": cc, "bgn_de": bgn, "page_count": 50})
        n += 1
        if j and j.get("status") in ("000", "013"):
            write_json(d / "list.json", j)
        elif err or (j and j.get("status") == "020"):
            fails.add("M2", u["ticker"], "DART 목록: " + (err or "일일 한도 초과(020)"))
            if j and j.get("status") == "020":
                return
        prev_m2 = read_json(prev / f"data/m2/kr/sym/{safe(u['ticker'])}.json") or {}
        if prev_m2.get("실적") and prev_m2.get("수집시각", "")[:7] == now.isoformat()[:7]:
            continue  # 월 1회만 갱신
        for reprt in ("11014", "11012", "11013", "11011"):  # 3분기·반기·1분기·사업보고서 순으로 최신 시도
            j, err = http.get_json("https://opendart.fss.or.kr/api/fnlttSinglAcnt.json", params={"crtfc_key": key, "corp_code": cc, "bsns_year": str(year), "reprt_code": reprt})
            n += 1
            if j and j.get("status") == "000":
                write_json(d / "accounts.json", j)
                break
    log(f"DART 호출 {n}회")


def collect_news(http_gov: Http, http_sec: Http, http_dart: Http, raw: Path, fails: Failures) -> None:
    src = config("news_sources.json")
    for s in [x for x in src["rss"] if x["enabled"]]:
        txt, err = http_gov.get(s["url"])
        if err:
            fails.add("M6", s["이름"], err)
            continue
        p = raw / "news/feeds" / f"{s['id']}.xml"
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(txt, encoding="utf-8")
    if src["filings"]["sec_8k"]["enabled"]:  # EDGAR 최신 공시 피드 1건(종목마다 조회하지 않음)
        txt, err = http_sec.get(src["filings"]["sec_8k"]["url"])
        if err:
            fails.add("M6", "SEC 8-K", err)
        else:
            (raw / "news").mkdir(parents=True, exist_ok=True)
            (raw / "news/sec8k.xml").write_text(txt, encoding="utf-8")
    key = env("OPENDART_KEY")
    if src["filings"]["dart"]["enabled"] and key:  # 공시 목록 1회 호출(유형별) 후 유니버스로 필터
        today = datetime.now(timezone(timedelta(hours=9))).strftime("%Y%m%d")
        allrows = []
        for ty in src["filings"]["dart"]["pblntf_ty"]:
            j, err = http_dart.get_json("https://opendart.fss.or.kr/api/list.json", params={"crtfc_key": key, "bgn_de": today, "end_de": today, "pblntf_ty": ty, "page_count": 100})
            if j and j.get("status") == "000":
                allrows += j.get("list", [])
            elif err:
                fails.add("M6", f"DART({ty})", err)
        write_json(raw / "news/dart_list.json", {"list": allrows})
    obs = {}
    rules = config("news_rules.json")
    for sid in rules["indicator_surprise"]["기준"].keys():
        o = fred_series(http_gov, sid, fails, limit=2)
        if len(o) >= 2:
            obs[sid] = {"series": sid, "latest": {"date": o[0]["date"], "value": float(o[0]["value"]), "realtime_start": o[0].get("realtime_start")},
                        "previous": {"date": o[1]["date"], "value": float(o[1]["value"])}}
    write_json(raw / "news/obs.json", obs)
