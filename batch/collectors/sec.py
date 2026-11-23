"""SEC EDGAR 수집(A급). User-Agent "이름 이메일" 필수(이메일은 Secrets), 초당 10건 이하(기본 8건/초).

수집한 원문(JSON·HTML·XML)은 파싱하지 않고 raw/ 에 저장하고, 파싱·정규화는 공용 TS 모듈이 한다(3-8).
"""
from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

from batch.common.core import Failures, Http, config, log, read_json, safe, write_json

BRK_CIK = "0001067983"
DATA = "https://data.sec.gov"
WWW = "https://www.sec.gov"


def company_tickers(http: Http, fails: Failures) -> dict[str, str]:
    j, err = http.get_json(f"{WWW}/files/company_tickers.json")
    if err:
        fails.add("SEC", "company_tickers", err)
        return {}
    return {v["ticker"].upper(): str(v["cik_str"]).zfill(10) for v in j.values()}


def company_titles(http: Http) -> dict[str, str]:
    j, err = http.get_json(f"{WWW}/files/company_tickers.json")
    return {} if err else {v["ticker"].upper(): v["title"] for v in j.values()}


def _recent(sub: dict) -> list[dict]:
    r = sub.get("filings", {}).get("recent", {})
    keys = ["accessionNumber", "filingDate", "reportDate", "form", "primaryDocument", "primaryDocDescription"]
    n = len(r.get("accessionNumber", []))
    return [{k: (r.get(k) or [None] * n)[i] for k in keys} for i in range(n)]


def doc_url(cik: str, acc: str, doc: str) -> str:
    return f"{WWW}/Archives/edgar/data/{int(cik)}/{acc.replace('-', '')}/{doc}"


def collect_company(http: Http, u: dict, prev: Path, raw: Path, fails: Failures) -> None:
    cik = u.get("cik")
    if not cik:
        fails.add("M1", u["ticker"], "CIK 없음(SEC 티커 목록에 없음)")
        return
    d = raw / "sec" / safe(u["ticker"])
    sub, err = http.get_json(f"{DATA}/submissions/CIK{cik}.json")
    if err:
        fails.add("M1", u["ticker"], "submissions: " + err)
        return
    rec = _recent(sub)
    write_json(d / "sub.json", {"sic": sub.get("sic"), "sicDescription": sub.get("sicDescription"), "name": sub.get("name")})
    cutoff = (datetime.now(timezone.utc) - timedelta(days=7)).date().isoformat()
    write_json(d / "recent.json", [{"form": f["form"], "filed": f["filingDate"], "url": doc_url(cik, f["accessionNumber"], f["primaryDocument"] or ""), "title": f.get("primaryDocDescription")}
                                    for f in rec if f["filingDate"] and f["filingDate"] >= cutoff][:30])
    prev_sym = read_json(prev / f"data/m1/sym/{safe(u['ticker'])}.json") or {}
    prev_meta = prev_sym.get("filings_meta") or {}
    meta: dict = {}
    for form in ("10-K", "DEF 14A"):
        f = next((x for x in rec if x["form"] == form), None)
        if f:
            meta[form] = {"accession": f["accessionNumber"], "filed": f["filingDate"], "url": doc_url(cik, f["accessionNumber"], f["primaryDocument"]), "doc": f["primaryDocument"]}
    latest_periodic = next((x["accessionNumber"] for x in rec if x["form"] in ("10-K", "10-Q", "10-K/A", "10-Q/A")), None)
    meta["latest_periodic"] = latest_periodic
    write_json(d / "filings.json", meta)
    # 재무: 새 정기보고서가 있거나 이전 값이 없을 때만 companyfacts(용량 큼)
    if latest_periodic != prev_meta.get("latest_periodic") or not prev_sym.get("input"):
        txt, err = http.get(f"{DATA}/api/xbrl/companyfacts/CIK{cik}.json")
        if err:
            fails.add("M1", u["ticker"], "companyfacts: " + err)
        else:
            (d / "facts.json").write_text(txt, encoding="utf-8")
    for form, fname in (("10-K", "10k.html"), ("DEF 14A", "def14a.html")):
        m = meta.get(form)
        if not m:
            continue
        if prev_meta.get(form, {}).get("accession") == m["accession"] and prev_sym.get("filings"):
            continue  # 같은 공시는 다시 받지 않음
        txt, err = http.get(m["url"])
        if err:
            fails.add("M1", u["ticker"], f"{form} 원문: " + err)
        else:
            (d / fname).write_text(txt[:8_000_000], encoding="utf-8")


def _norm_name(s: str) -> str:
    s = s.upper()
    s = re.sub(r"[^A-Z0-9 ]", " ", s)
    s = re.sub(r"\b(INC|CORP|CORPORATION|CO|COMPANY|LTD|PLC|HOLDINGS?|GROUP|THE|DEL|NEW|COM|CL|CLASS|A|B|C|SA|NV|AG)\b", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def collect_berkshire(http: Http, raw: Path, uni: list[dict], titles: dict[str, str], fails: Failures) -> None:
    """버크셔 13F-HR 최신·직전 분기(+같은 기준일 13F-HR/A), 최근 90일 Form 4·Schedule 13D/13G."""
    d = raw / "berkshire"
    sub, err = http.get_json(f"{DATA}/submissions/CIK{BRK_CIK}.json")
    if err:
        fails.add("버크셔", "13F", "submissions: " + err)
        return
    rec = _recent(sub)
    hr = [f for f in rec if f["form"] == "13F-HR"]
    meta = {}

    def fetch_filing(f, name):
        idx, e = http.get_json(f"{WWW}/Archives/edgar/data/{int(BRK_CIK)}/{f['accessionNumber'].replace('-', '')}/index.json")
        if e:
            fails.add("버크셔", name, "index: " + e)
            return False
        items = [i["name"] for i in idx.get("directory", {}).get("item", []) if i["name"].lower().endswith(".xml")]
        cover = next((i for i in items if "primary_doc" in i.lower()), None)
        info = next((i for i in items if i != cover), None)
        ok = False
        if info:
            x, e = http.get(doc_url(BRK_CIK, f["accessionNumber"], info))
            if not e:
                (d / f"{name}.xml").parent.mkdir(parents=True, exist_ok=True)
                (d / f"{name}.xml").write_text(x, encoding="utf-8")
                ok = True
        if cover:
            x, e = http.get(doc_url(BRK_CIK, f["accessionNumber"], cover))
            if not e:
                (d / f"{name}_cover.xml").write_text(x, encoding="utf-8")
        return ok

    if hr:
        if fetch_filing(hr[0], "cur"):
            meta["cur"] = {"accession": hr[0]["accessionNumber"], "filed": hr[0]["filingDate"], "period": hr[0]["reportDate"]}
        prevf = next((f for f in hr[1:] if f["reportDate"] != hr[0]["reportDate"]), None)
        if prevf and fetch_filing(prevf, "prev"):
            meta["prev"] = {"accession": prevf["accessionNumber"], "filed": prevf["filingDate"], "period": prevf["reportDate"]}
        amend = next((f for f in rec if f["form"] == "13F-HR/A" and f["reportDate"] == hr[0]["reportDate"]), None)
        if amend:
            fetch_filing(amend, "amend")
    write_json(d / "meta.json", meta)
    cutoff = (datetime.now(timezone.utc) - timedelta(days=90)).date().isoformat()
    sched = []  # 13D/13G: 대상 회사·주식 수는 자동 해석하지 않고 목록과 원문 링크만(형식이 자유 서술이라 오해석 위험)
    for f in [x for x in rec if x["form"] in ("4", "SC 13D", "SC 13D/A", "SC 13G", "SC 13G/A", "SCHEDULE 13D", "SCHEDULE 13D/A", "SCHEDULE 13G", "SCHEDULE 13G/A") and x["filingDate"] >= cutoff][:40]:
        if f["form"] != "4":
            sched.append({"양식": f["form"], "제출일": f["filingDate"], "접수번호": f["accessionNumber"],
                          "원문": f"{WWW}/Archives/edgar/data/{int(BRK_CIK)}/{f['accessionNumber'].replace('-', '')}/"})
            continue
        docname = re.sub(r"^xsl[^/]*/", "", f["primaryDocument"] or "")
        url = doc_url(BRK_CIK, f["accessionNumber"], docname)
        x, e = http.get(url)
        if not e:
            (d / "form4").mkdir(parents=True, exist_ok=True)
            (d / "form4" / f"{safe(f['accessionNumber'])}.xml").write_text(x, encoding="utf-8")
            write_json(d / "form4" / f"{safe(f['accessionNumber'])}.json", {"filed": f["filingDate"], "url": url})
    write_json(d / "sched13.json", sched)
    # CUSIP→티커: 무료 공식 매핑이 없어 이름 대조(C급) + config/cusip_overrides.json
    overrides = config("cusip_overrides.json") or {}
    by_name: dict[str, str] = {}
    unis = {u["ticker"] for u in uni}
    for t, title in titles.items():
        if t.replace("-", ".") in unis or t in unis:
            by_name.setdefault(_norm_name(title), t.replace("-", "."))
    cmap = {}
    for fn in ("cur.xml", "prev.xml"):
        p = d / fn
        if not p.exists():
            continue
        txt = p.read_text(encoding="utf-8")
        for m in re.finditer(r"<(?:\w+:)?nameOfIssuer>([^<]+)</(?:\w+:)?nameOfIssuer>[\s\S]*?<(?:\w+:)?cusip>([^<]+)</(?:\w+:)?cusip>", txt):
            name, cusip = m.group(1), m.group(2).strip().upper()
            if cusip in overrides.get("map", {}):
                cmap[cusip] = {"ticker": overrides["map"][cusip], "grade": "C"}
            elif _norm_name(name) in by_name:
                cmap[cusip] = {"ticker": by_name[_norm_name(name)], "grade": "C"}
    write_json(d / "cusip_map.json", cmap)
    log(f"버크셔 13F: {'있음' if meta.get('cur') else '없음'}, CUSIP 매핑 {len(cmap)}건")
