"""테스트용 합성 데이터로 배치 파이프라인 전체(원본 → 공용 TS 계산 → 암호화)를 돌려 사이트를 만든다.
실측 데이터가 아니다. 개발 환경에서 외부 출처에 접속할 수 없기 때문에 응답 형식만 흉내 낸 고정 픽스처다.

사용: python scripts/make_fixture.py <출력폴더> [--key BASE64]
XSS 픽스처: 뉴스 제목·요약에 스크립트 태그를 넣는다(10절 16번).
"""
import argparse
import base64
import json
import math
import os
import shutil
import subprocess
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CLI = ["node", str(ROOT / "batch/calc/dist/cli.mjs")]
XSS = '<img src=x onerror="window.__xss=1">악성<script>window.__xss=1</script>'


def wj(p, o):
    p = Path(p); p.parent.mkdir(parents=True, exist_ok=True); p.write_text(json.dumps(o, ensure_ascii=False), encoding="utf-8")


def csv_series(start, n, base, drift, vol, seed, end=None):
    """결정적(난수 없음) 합성 가격: 주말 제외"""
    rows, d, v, i = [], start, base, 0
    end = end or date(2026, 11, 20)
    while d <= end and i < n:
        if d.weekday() < 5:
            v = max(0.5, v * (1 + drift + vol * math.sin(i * 0.07 + seed) * math.cos(i * 0.013 + seed)))
            rows.append(f"{d.isoformat()},{v:.4f},{v*1.01:.4f},{v*0.99:.4f},{v:.4f},{1000 + (i % 50) * 10}")
            i += 1
        d += timedelta(days=1)
    return "Date,Open,High,Low,Close,Volume\n" + "\n".join(rows) + "\n"


def facts(cik):
    def fy(val_fn, kind="flow"):
        out = []
        for i, y in enumerate(range(2016, 2026)):
            e = f"{y}-12-31"
            f = {"end": e, "val": val_fn(i), "form": "10-K", "fy": y, "fp": "FY", "filed": f"{y+1}-02-15"}
            if kind == "flow":
                f["start"] = f"{y}-01-01"
            out.append(f)
        return {"units": {"USD": out}}
    g = lambda i: 1.08 ** i
    usg = {
        "Revenues": fy(lambda i: 1000e6 * g(i)), "CostOfRevenue": fy(lambda i: 500e6 * g(i)), "GrossProfit": fy(lambda i: 500e6 * g(i)),
        "OperatingIncomeLoss": fy(lambda i: 250e6 * g(i)), "NetIncomeLoss": fy(lambda i: 180e6 * g(i)),
        "DepreciationDepletionAndAmortization": fy(lambda i: 45e6 * g(i)), "PaymentsToAcquirePropertyPlantAndEquipment": fy(lambda i: 50e6 * g(i)),
        "IncreaseDecreaseInOperatingCapital": fy(lambda i: 5e6 * g(i)), "StockholdersEquity": fy(lambda i: 1000e6 * g(i), "instant"),
        "Liabilities": fy(lambda i: 600e6 * g(i), "instant"), "LongTermDebt": fy(lambda i: 100e6, "instant"),
        "CashAndCashEquivalentsAtCarryingValue": fy(lambda i: 300e6 * g(i), "instant"), "InterestExpense": fy(lambda i: 10e6),
        "InvestmentIncomeInterest": fy(lambda i: 3e6), "IncomeTaxExpenseBenefit": fy(lambda i: 50e6 * g(i)),
        "IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest": fy(lambda i: 250e6 * g(i)),
        "PaymentsOfDividends": fy(lambda i: 50e6 * g(i)), "PaymentsForRepurchaseOfCommonStock": fy(lambda i: 20e6 * g(i)),
    }
    usg["WeightedAverageNumberOfDilutedSharesOutstanding"] = {"units": {"shares": fy(lambda i: 100e6)["units"]["USD"]}}
    dei = {"EntityCommonStockSharesOutstanding": {"units": {"shares": [{"end": f"{y}-12-31", "val": 100e6, "form": "10-K", "fy": y, "fp": "FY", "filed": f"{y+1}-02-15"} for y in range(2016, 2026)]}}}
    return {"cik": int(cik), "entityName": "Testco Inc", "facts": {"us-gaap": usg, "dei": dei}}


def build(out: Path, key: str):
    work = out.parent / (out.name + "_work")
    if work.exists():
        shutil.rmtree(work)
    env = {**os.environ, "DATA_KEY": key}
    # ── 미국 ──
    raw = work / "raw_us"
    uni = [
        {"ticker": "TST", "name": "Testco Inc", "market": "US", "kind": "stock", "indices": ["SP500", "NDX"], "sector": "Information Technology", "cik": "0000000001", "m1": True, "top_cap": True},
        {"ticker": "BAD", "name": "Badco (실패 종목)", "market": "US", "kind": "stock", "indices": ["SP500"], "cik": "0000000002", "m1": True},
        {"ticker": "SOXX", "name": "iShares Semiconductor ETF", "market": "US", "kind": "etf", "indices": ["ETF"]},
        {"ticker": "SOXL", "name": "Direxion Daily Semiconductor Bull 3X", "market": "US", "kind": "etf", "indices": ["ETF"]},
        {"ticker": "TQQQ", "name": "ProShares UltraPro QQQ", "market": "US", "kind": "etf", "indices": ["ETF"]},
        {"ticker": "BTC", "name": "Bitcoin (USD)", "market": "CRYPTO", "kind": "crypto", "indices": ["CRYPTO"], "stooq": "btcusd"},
    ]
    wj(raw / "universe.json", uni)
    for t, base, drift, vol, seed in (("TST", 20, 0.0004, 0.02, 1), ("SOXX", 100, 0.0003, 0.025, 2), ("SOXL", 30, 0.0002, 0.06, 3), ("TQQQ", 40, 0.0004, 0.05, 4)):
        p = raw / "prices_src/us" / t
        p.parent.mkdir(parents=True, exist_ok=True)
        p.with_suffix(".csv").write_text(csv_series(date(2012, 1, 3), 4000, base, drift, vol, seed), encoding="utf-8")
        wj(p.with_suffix(".meta.json"), {"ticker": t, "source": "Stooq", "grade": "C", "format": "stooq", "full": True})
    wj(raw / "prices_src/us/BAD.meta.json", {"ticker": "BAD", "source": None, "grade": None, "format": None, "full": True, "error": "데이터 없음(픽스처: 일부러 실패)"})
    btc = []
    d = date(2015, 1, 1); v = 300.0; i = 0
    while d <= date(2026, 11, 20):
        v = max(50, v * (1 + 0.0012 + 0.04 * math.sin(i * 0.05)))
        btc.append(f"{d.isoformat()},{v:.2f},{v:.2f},{v:.2f},{v:.2f},0"); d += timedelta(days=1); i += 1
    (raw / "prices_src/us/BTC.csv").write_text("Date,Open,High,Low,Close,Volume\n" + "\n".join(btc), encoding="utf-8")
    wj(raw / "prices_src/us/BTC.meta.json", {"ticker": "BTC", "source": "Stooq", "grade": "C", "format": "stooq", "full": True})
    wj(raw / "rates.json", {"DGS10": {"value": 4.2, "date": "2026-11-19"}, "DEXKOUS": [[f"{y}-01-02", 1300.0] for y in range(2012, 2027)], "출처": "FRED", "등급": "A"})
    wj(raw / "sec/TST/facts.json", facts(1))
    wj(raw / "sec/TST/sub.json", {"sic": "7372"})
    wj(raw / "sec/TST/filings.json", {"10-K": {"accession": "0000000001-26-000001", "filed": "2026-02-15", "url": "https://www.sec.gov/Archives/edgar/data/1/000000000126000001/tst-10k.htm"}, "latest_periodic": "x"})
    (raw / "sec/TST/10k.html").write_text("<html><body><p>Table of contents Item 1. Business ... Item 1A. Risk Factors</p><p>Item 1. Business</p><p>" + ("Testco sells software subscriptions to businesses. " * 40) + f"{XSS}</p><p>Item 1A. Risk Factors</p></body></html>", encoding="utf-8")
    wj(raw / "sec/TST/recent.json", [{"form": "8-K", "filed": "2026-11-18", "url": "https://www.sec.gov/Archives/edgar/data/1/x/y.htm", "title": "Current report"}])
    wj(raw / "summaries/0000000001-26-000001.json", {"accession": "0000000001-26-000001", "summary": "Testco는 기업용 소프트웨어 구독을 판매한다.", "numcheck": {"오류": 0}})
    bk = raw / "berkshire"; bk.mkdir(parents=True, exist_ok=True)
    info = lambda sh: f"<informationTable><infoTable><nameOfIssuer>TESTCO INC</nameOfIssuer><titleOfClass>COM</titleOfClass><cusip>000000AA1</cusip><value>{sh*30}</value><shrsOrPrnAmt><sshPrnamt>{sh}</sshPrnamt><sshPrnamtType>SH</sshPrnamtType></shrsOrPrnAmt></infoTable><infoTable><nameOfIssuer>TESTCO INC</nameOfIssuer><titleOfClass>COM</titleOfClass><cusip>000000AA1</cusip><value>{sh*10}</value><shrsOrPrnAmt><sshPrnamt>{sh//3}</sshPrnamt><sshPrnamtType>SH</sshPrnamtType></shrsOrPrnAmt></infoTable><infoTable><nameOfIssuer>OTHER CO</nameOfIssuer><titleOfClass>COM</titleOfClass><cusip>999999ZZ9</cusip><value>5000000</value><shrsOrPrnAmt><sshPrnamt>100000</sshPrnamt><sshPrnamtType>SH</sshPrnamtType></shrsOrPrnAmt></infoTable></informationTable>"
    (bk / "cur.xml").write_text(info(90000), encoding="utf-8"); (bk / "prev.xml").write_text(info(60000), encoding="utf-8")
    (bk / "cur_cover.xml").write_text("<edgarSubmission><periodOfReport>09-30-2026</periodOfReport></edgarSubmission>", encoding="utf-8")
    (bk / "prev_cover.xml").write_text("<edgarSubmission><periodOfReport>06-30-2026</periodOfReport></edgarSubmission>", encoding="utf-8")
    wj(bk / "meta.json", {"cur": {"accession": "0000950123-26-000001", "filed": "2026-11-14"}, "prev": {"accession": "0000950123-26-000000", "filed": "2026-08-14"}})
    wj(bk / "cusip_map.json", {"000000AA1": {"ticker": "TST", "grade": "C"}})
    wj(raw / "collect_failures.json", [{"모듈": "M1", "대상": "BAD", "사유": "companyfacts: 없음(404) — 픽스처"}])
    # ── 국내 ──
    rawk = work / "raw_kr"
    wj(rawk / "universe.json", [{"ticker": "005930", "name": "Samsung Electronics", "name_ko": "삼성전자", "market": "KR", "kind": "stock", "indices": ["KOSPI"], "corp_code": "00126380"}])
    p = rawk / "prices_src/kr/005930"; p.parent.mkdir(parents=True, exist_ok=True)
    p.with_suffix(".csv").write_text(csv_series(date(2015, 1, 2), 3600, 30000, 0.0003, 0.02, 5), encoding="utf-8")
    wj(p.with_suffix(".meta.json"), {"ticker": "005930", "source": "Stooq", "grade": "C", "format": "stooq", "full": True})
    wj(rawk / "rates_kr.json", {"KR10Y": {"value": 3.1, "date": "2026-11-20"}, "출처": "한국은행 ECOS", "등급": "A"})
    # ── 뉴스 ──
    rawn = work / "raw_news"
    wj(rawn / "universe.json", uni + [{"ticker": "005930", "name": "Samsung Electronics", "name_ko": "삼성전자", "market": "KR", "kind": "stock", "indices": ["KOSPI"]}])
    now = datetime.now(timezone.utc)
    iso = lambda h: (now - timedelta(hours=h)).strftime("%a, %d %b %Y %H:%M:%S GMT")
    rss = f"""<?xml version="1.0"?><rss><channel>
<item><title>Federal Reserve cuts rates in emergency move</title><link>https://www.federalreserve.gov/newsevents/pressreleases/monetary-fixture1.htm</link><pubDate>{iso(2)}</pubDate><description>The Committee decided to lower the target range.</description></item>
<item><title><![CDATA[Federal Reserve issues FOMC statement {XSS}]]></title><link>https://www.federalreserve.gov/newsevents/pressreleases/monetary-fixture2.htm</link><pubDate>{iso(5)}</pubDate><description><![CDATA[{XSS} statement text]]></description></item>
<item><title>&lt;img src=x onerror="window.__xss=1"&gt; Testco &lt;script&gt;window.__xss=1&lt;/script&gt; trading halt</title><link>https://www.federalreserve.gov/fixture4.htm</link><pubDate>{iso(4)}</pubDate><description>&lt;b onmouseover=window.__xss=1&gt;x&lt;/b&gt;</description></item>
<item><title>Testco Inc announces merger agreement</title><link>https://www.federalreserve.gov/fixture3.htm</link><pubDate>{iso(3)}</pubDate><description>Board approves.</description></item>
<item><title>Old item outside retention</title><link>https://www.federalreserve.gov/old.htm</link><pubDate>{(now - timedelta(days=20)).strftime("%a, %d %b %Y %H:%M:%S GMT")}</pubDate></item>
</channel></rss>"""
    (rawn / "news/feeds").mkdir(parents=True, exist_ok=True)
    (rawn / "news/feeds/fed_monetary.xml").write_text(rss, encoding="utf-8")
    (rawn / "news/feeds/fed_all.xml").write_text(rss, encoding="utf-8")
    wj(rawn / "news/dart_list.json", {"list": [{"rcept_no": "20261123000001", "corp_name": "삼성전자", "report_nm": "주요사항보고서(유상증자결정)", "stock_code": "005930", "rcept_dt": now.strftime("%Y%m%d")}]})
    wj(rawn / "news/obs.json", {})
    wj(rawn / "runinfo.json", {"scheduled": (now.replace(minute=7, second=0, microsecond=0) - timedelta(hours=1 if now.minute < 7 else 0)).isoformat(), "started": now.isoformat(), "manual": False})
    subprocess.run(CLI + ["excerpts", str(raw)], check=True, env=env)
    # ── 계산·암호화 ──
    prev = work / "prev"; prev.mkdir(parents=True, exist_ok=True)
    o = work / "out"
    for job, r in (("us", raw), ("kr", rawk), ("news", rawn)):
        subprocess.run(CLI + [f"build-{job}", str(r), str(prev), str(o)], check=True, env=env)
    pub = work / "publish"
    subprocess.run(CLI + ["seal", str(o), str(pub)], check=True, env=env)
    subprocess.run(CLI + ["merge-status", str(pub)], check=True, env=env)
    if out.exists():
        shutil.rmtree(out)
    shutil.copytree(ROOT / "web/dist", out)
    shutil.copytree(pub / "data", out / "data")
    return work


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("--key", default=None)
    a = ap.parse_args()
    k = a.key or base64.b64encode(os.urandom(32)).decode()
    w = build(Path(a.out), k)
    print(json.dumps({"site": a.out, "key": k, "work": str(w)}))
