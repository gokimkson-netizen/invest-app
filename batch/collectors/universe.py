"""분석 유니버스 해석: config/universe.json(공개)에 선언된 지수·ETF·추가 종목만 대상으로 한다(3-2).

- S&P500·나스닥100: 무료 공식 목록이 없어 Wikipedia 표(C급, CC BY-SA)에서 구성종목을 읽는다. 실패하면 직전 목록 사용.
- 코스피: OpenDART 고유번호 목록 + 기업개황 corp_cls=Y(유가증권시장, A급). 월 1회 갱신.
- 관심종목은 브라우저에만 있으므로 여기서 다루지 않는다.
"""
from __future__ import annotations

import html
import io
import re
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from xml.etree import ElementTree as ET

from batch.common.core import Failures, Http, config, env, log, read_json, write_json

WIKI_API = "https://en.wikipedia.org/w/api.php"
# Wikimedia User-Agent 정책: "<클라이언트>/<버전> (<연락처>) <라이브러리>/<버전>" 형식, 연락처(이메일·URL) 필수.
# 요청은 하루 2건, 직렬(동시 요청 없음). 근거와 확인일은 docs/data-sources.md
WIKI_MIN_ROWS = {"SP500": 450, "NDX": 90}  # 이보다 적으면 표 형식 변경·부분 응답으로 보고 직전 목록 사용


def wiki_user_agent() -> str | None:
    """WIKI_USER_AGENT(선택 비밀값) → 없으면 SEC_USER_AGENT(이름 이메일)를 연락처로 사용. 둘 다 없으면 None(수집 생략)."""
    custom = env("WIKI_USER_AGENT")
    if custom:
        return custom
    sec = env("SEC_USER_AGENT")
    return f"invest-app-batch/1.0 ({sec}) python-requests" if sec else None


def _cells(row_html: str) -> list[str]:
    cells = re.findall(r"<t[hd][^>]*>([\s\S]*?)</t[hd]>", row_html, re.I)
    return [html.unescape(re.sub(r"<[^>]+>", "", c)).strip() for c in cells]


def parse_wiki_constituents(page_html: str) -> list[dict]:
    """id="constituents" 표에서 머리글 이름으로 열을 찾는다(Symbol/Ticker, Security/Company, GICS Sector, CIK)."""
    m = re.search(r'<table[^>]*id="constituents"[\s\S]*?</table>', page_html, re.I)
    if not m:
        return []
    rows = re.findall(r"<tr[\s\S]*?</tr>", m.group(0), re.I)
    if not rows:
        return []
    head = [h.lower() for h in _cells(rows[0])]

    def col(*names):
        for n in names:
            for i, h in enumerate(head):
                if n in h:
                    return i
        return -1

    iT, iN, iS, iC = col("symbol", "ticker"), col("security", "company"), col("gics sector", "sector"), col("cik")
    out = []
    for r in rows[1:]:
        c = _cells(r)
        if iT < 0 or len(c) <= max(iT, iN):
            continue
        t = c[iT].strip().upper()
        if not re.fullmatch(r"[A-Z][A-Z0-9.\-]{0,9}", t):
            continue
        out.append({"ticker": t, "name": c[iN] if iN >= 0 else t, "sector": c[iS] if 0 <= iS < len(c) else None,
                    "cik": c[iC].zfill(10) if 0 <= iC < len(c) and c[iC].isdigit() else None})
    return out


def fetch_wiki(http: Http, page: str) -> tuple[list[dict], str | None]:
    data, err = http.get_json(WIKI_API, params={"action": "parse", "page": page, "prop": "text", "format": "json", "formatversion": "2"})
    if err:
        return [], err
    txt = (data or {}).get("parse", {}).get("text", "")
    rows = parse_wiki_constituents(txt)
    return rows, None if rows else "표 형식 변경으로 구성종목을 찾지 못함"


def fetch_kospi(http: Http, prev_cache: dict | None, fails: Failures) -> tuple[list[dict], dict]:
    """OpenDART corpCode.xml(zip) → 상장사 → company.json corp_cls. 캐시가 30일 이내면 재사용."""
    key = env("OPENDART_KEY")
    now = datetime.now(timezone.utc)
    if prev_cache and prev_cache.get("updated") and (now - datetime.fromisoformat(prev_cache["updated"])).days < 30:
        return prev_cache["kospi"], prev_cache
    if not key:
        fails.add("유니버스", "코스피", "OPENDART_KEY 없음")
        return (prev_cache or {}).get("kospi", []), prev_cache or {}
    blob, err = http.get("https://opendart.fss.or.kr/api/corpCode.xml", params={"crtfc_key": key}, binary=True)
    if err:
        fails.add("유니버스", "코스피", "corpCode 수집 실패: " + err)
        return (prev_cache or {}).get("kospi", []), prev_cache or {}
    try:
        xml = zipfile.ZipFile(io.BytesIO(blob)).read("CORPCODE.xml")
        root = ET.fromstring(xml)
    except Exception:
        fails.add("유니버스", "코스피", "corpCode 압축 해제 실패")
        return (prev_cache or {}).get("kospi", []), prev_cache or {}
    listed = []
    for el in root.iter("list"):
        sc = (el.findtext("stock_code") or "").strip()
        if sc:
            listed.append({"corp_code": el.findtext("corp_code"), "stock_code": sc, "name_ko": (el.findtext("corp_name") or "").strip(), "name_en": (el.findtext("corp_eng_name") or "").strip()})
    cls_cache = (prev_cache or {}).get("cls", {})
    kospi = []
    for c in listed:
        cls = cls_cache.get(c["corp_code"])
        if cls is None:
            j, e = http.get_json("https://opendart.fss.or.kr/api/company.json", params={"crtfc_key": key, "corp_code": c["corp_code"]})
            if e or not j or j.get("status") != "000":
                continue
            cls = j.get("corp_cls")
            cls_cache[c["corp_code"]] = cls
        if cls == "Y":
            kospi.append({"ticker": c["stock_code"], "name": c["name_en"] or c["name_ko"], "name_ko": c["name_ko"], "corp_code": c["corp_code"]})
    cache = {"updated": now.isoformat(), "kospi": kospi, "cls": cls_cache, "listed": [{"stock_code": c["stock_code"], "corp_code": c["corp_code"], "name_ko": c["name_ko"]} for c in listed]}
    return kospi, cache


def resolve(http_wiki: Http, http_dart: Http | None, sec_tickers: dict[str, str], prev: Path, market: str, fails: Failures, out_dir: Path | None = None) -> list[dict]:
    """market: 'US'(지수 미국 + ETF 미국 + BTC + 추가 미국) 또는 'KR'."""
    cfg = config("universe.json")
    prev_res = read_json(prev / ("state/us/universe.json" if market == "US" else "state/kr/universe.json"), []) or []
    prev_by = {u["ticker"]: u for u in prev_res}
    out: dict[str, dict] = {}
    retrieved = datetime.now(timezone.utc).date().isoformat()

    def add(t, name, mkt, kind, idx=None, **kw):
        u = out.get(t) or {"ticker": t, "name": name, "market": mkt, "kind": kind, "indices": [], "m1": False}
        if idx and idx not in u["indices"]:
            u["indices"].append(idx)
        for k, v in kw.items():
            if v is not None:
                u[k] = v
        out[t] = u

    if market == "US":
        for idx, page in (("SP500", "List_of_S&P_500_companies"), ("NDX", "Nasdaq-100")):
            if http_wiki is None:
                rows, err = [], "연락처가 있는 User-Agent 없음(WIKI_USER_AGENT 또는 SEC_USER_AGENT 비밀값 필요)"
            else:
                rows, err = fetch_wiki(http_wiki, page)
            if not err and len(rows) < WIKI_MIN_ROWS[idx]:
                err = f"구성종목 {len(rows)}개뿐(최소 {WIKI_MIN_ROWS[idx]}) — 표 형식 변경 의심"
                rows = []
            got = retrieved
            if err:
                rows = [{"ticker": u["ticker"], "name": u["name"], "sector": u.get("sector"), "cik": u.get("cik"), "d": u.get("구성종목_수집일")} for u in prev_res if idx in u.get("indices", [])]
                if rows:
                    fails.add("유니버스", idx, "구성종목 수집 실패 — 직전 목록 사용: " + err)
                    got = None
                else:  # 첫 실행 실패: 직전 목록도 없음 → 이 지수 종목은 이번 실행에서 빠진다(다음 실행에서 다시 시도)
                    fails.add("유니버스", idx, "구성종목 수집 실패(첫 실행이라 직전 목록 없음) — 이 지수는 이번에 빠지고 다음 실행에서 다시 시도: " + err)
            for r in rows:
                cik = r.get("cik") or sec_tickers.get(r["ticker"].replace(".", "-"))
                add(r["ticker"], r["name"], "US", "stock", idx, sector=r.get("sector"), cik=cik, m1=True, 구성종목_수집일=got or r.get("d"), 구성종목_등급="C")
        for e in cfg.get("etfs", []):
            if e["market"] == "US":
                add(e["ticker"], e["name"], "US", "etf", "ETF")
        for c in cfg.get("crypto", []):
            add(c["ticker"], c["name"], "CRYPTO", "crypto", "CRYPTO", stooq=c.get("stooq"))
        for x in cfg.get("extra", []):
            if x.get("market") == "US":
                add(x["ticker"], x.get("name", x["ticker"]), "US", "stock", "추가", cik=sec_tickers.get(x["ticker"].replace(".", "-")))
        # 시총 상위(직전 M1 결과 기준) — M6 관련성 가중용
        m1idx = read_json(prev / "data/m1/index.json", {}) or {}
        caps = sorted([r for r in m1idx.get("rows", []) if r.get("시가총액")], key=lambda r: -r["시가총액"])[: cfg.get("top_cap_count", 20)]
        for r in caps:
            if r["ticker"] in out:
                out[r["ticker"]]["top_cap"] = True
    else:
        cache_p = prev / "state/kr/kospi_cache.json"
        kospi, cache = fetch_kospi(http_dart, read_json(cache_p), fails) if http_dart else ([], {})
        if cache and out_dir:
            write_json(out_dir / "state/kr/kospi_cache.json", cache)
        if not kospi:
            kospi = [{"ticker": u["ticker"], "name": u["name"], "name_ko": u.get("name_ko"), "corp_code": u.get("corp_code")} for u in prev_res if "KOSPI" in u.get("indices", [])]
        for r in kospi:
            add(r["ticker"], r["name"], "KR", "stock", "KOSPI", name_ko=r.get("name_ko"), corp_code=r.get("corp_code"))
        for e in cfg.get("etfs", []):
            if e["market"] == "KR":
                add(e["ticker"], e["name"], "KR", "etf", "ETF", name_ko=e["name"])
        for x in cfg.get("extra", []):
            if x.get("market") == "KR":
                add(x["ticker"], x.get("name", x["ticker"]), "KR", "stock", "추가", name_ko=x.get("name"))
    res = list(out.values())
    for u in res:  # 이전 실행 정보(CUSIP 등) 보존
        p = prev_by.get(u["ticker"])
        if p:
            for k in ("cusips",):
                if p.get(k) and not u.get(k):
                    u[k] = p[k]
    log(f"유니버스 {market}: {len(res)}종목")
    return res
