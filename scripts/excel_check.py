"""[로컬 전용] 10절 8번: 사용자 MDD 엑셀과 웹앱 M3 비교. 원본은 private/ 에만 두고 커밋하지 않는다.
사용: python scripts/excel_check.py [private/MDD.xlsx] [--prices private/prices]
출력(JSON)에는 일치 여부·건수·최대 오차·원본 해시만 남기고 엑셀 값 자체는 남기지 않는다.

검사
 A. 빈도표 재현: 종목 시트의 연도별 MDD 목록(엑셀 계산값)을 웹앱 공용 빈도표 함수(TS)에 넣어 엑셀 빈도 수와 정확히 일치하는지
 B. 평균 MDD 집계 재현: 요약 시트 '평균 MDD'와 종목 시트 연도별 MDD 평균이 0.01%p 안에서 일치하는지
 C. 가격 데이터 재현: private/prices/<종목>.csv(Date,Open,High,Low,Close)가 있으면 엑셀 정의로 다시 계산해 요약 시트 값과 비교(0.01%p).
    가격 파일이 없으면 '보류'. 준비: README '엑셀 가격 재현(선택)'.
 B는 엑셀 안의 값끼리 비교(정의 해석 확인)이며 웹앱 계산 검증이 아니다. 웹앱 정의(수정주가 종가)와의 차이는 정의 차이로 따로 보고한다(D3·D4).
허용 오차: 비율 지표 0.01%p, 빈도표(횟수) 정확히 일치."""
import hashlib
import re
import json
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TOL = 0.01  # %p

DEF_DIFF = [
    "가격: 엑셀 GOOGLEFINANCE는 분할만 반영(배당 미반영) / 웹앱은 수정주가(분할·배당, D3)",
    "연간 기준값: 엑셀은 그해 첫 거래일 시가(open) / 웹앱은 시장별 첫 거래일 종가(D4)",
    "연중 최고·최저: 엑셀은 장중 고가·저가 / 웹앱은 종가",
    "연중 MDD: 엑셀은 (연중 최고가 − 연중 최저가) ÷ 연중 최고가(최저가가 최고가보다 먼저 와도 계산) / 웹앱은 시간 순서를 지키는 최대 낙폭(고점 이후 저점)",
    "표본 연도: 엑셀은 상장 첫해·올해(진행 중) 포함 / 웹앱은 완결 연도만",
    "고점 대비 현재 하락률: 엑셀은 1980년 이후 장중 최고가 대비 현재가 / 웹앱은 기간별 종가 최고 대비 최신 종가",
    "낙폭 0%인 해: 엑셀 빈도표는 세지 않음(>0) / 웹앱은 '5% 이하'에 셈",
    "BTC: 엑셀 요약 시트는 종가 기반 연중 최고·최저, 종목 시트와 계산 방식이 달라 평균 MDD가 약간 다름",
]


def summary_full(wb):
    out = {}
    for r in wb[wb.sheetnames[0]].iter_rows(min_row=4):
        t = r[2].value
        if t and all(isinstance(r[i].value, (int, float)) for i in (3, 4, 5, 6)):
            out[str(t).replace("CURRENCY:", "")] = {"표본년수": r[3].value, "평균상승": r[4].value * 100, "평균낙폭": r[5].value * 100, "평균MDD": r[6].value * 100}
    return out


def price_check(folder, summ):
    """엑셀 정의로 재계산: 연도별 (첫 거래일 시가, 연중 장중 최고·최저), 상장 첫해·올해 포함."""
    import csv
    res, worst = [], 0.0
    for f in sorted(folder.glob("*.csv")):
        t = f.stem.upper()
        if t not in summ:
            continue
        rows = [r for r in csv.DictReader(f.open(encoding="utf-8")) if r.get("Open")]
        years = {}
        for r in rows:
            y = r["Date"][:4]
            o, h, l = float(r["Open"]), float(r["High"]), float(r["Low"])
            d = years.setdefault(y, {"open": o, "high": h, "low": l})
            d["high"], d["low"] = max(d["high"], h), min(d["low"], l)
        up = [(v["high"] - v["open"]) / v["open"] * 100 for v in years.values()]
        dn = [(v["low"] - v["open"]) / v["open"] * 100 for v in years.values()]
        md = [(v["low"] - v["high"]) / v["high"] * 100 for v in years.values()]
        mine = {"표본년수": len(years), "평균상승": sum(up) / len(up), "평균낙폭": sum(dn) / len(dn), "평균MDD": sum(md) / len(md)}
        err = {k: abs(mine[k] - summ[t][k]) for k in ("평균상승", "평균낙폭", "평균MDD")}
        worst = max(worst, *err.values())
        res.append({"표본년수일치": mine["표본년수"] == summ[t]["표본년수"], "최대오차%p": round(max(err.values()), 4)})
    return {"상태": "일치" if res and worst <= TOL else ("불일치" if res else "보류"), "비교종목수": len(res), "최대오차%p": round(worst, 4), "표본년수불일치": sum(not r["표본년수일치"] for r in res),
            "참고": "가격 출처가 다르면(배당 반영 여부 등) 오차가 날 수 있음 — 가격 기준 차이로 분리 보고"}


def freq_ts(mdd_pcts):
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
        json.dump(mdd_pcts, f)
    r = subprocess.run(["node", str(ROOT / "batch/calc/dist/cli.mjs"), "mdd-freq", f.name], capture_output=True, text=True, check=True)
    Path(f.name).unlink()
    return json.loads(r.stdout)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    xl = Path(args[0]) if args else ROOT / "private/MDD.xlsx"
    now = datetime.now(timezone.utc).isoformat()
    if not xl.exists():
        print(json.dumps({"상태": "보류", "사유": "MDD 엑셀 원본 미제공(private/에 없음)", "실행시각": now}, ensure_ascii=False))
        return 0
    import openpyxl
    wb = openpyxl.load_workbook(xl, data_only=True)
    wf = openpyxl.load_workbook(xl)  # 수식(구간 수식 오류 검출용)
    summary = {}
    for r in wb[wb.sheetnames[0]].iter_rows(min_row=4):
        t = r[2].value
        if t and isinstance(r[6].value, (int, float)):
            summary[str(t)] = {"평균MDD": r[6].value * 100}
    a_ok = a_n = 0
    a_fail, b_err, xl_bugs = [], [], []
    for name in wb.sheetnames[1:]:
        ws = wb[name]
        ticker = str(ws["B2"].value)
        mdds = [-(ws.cell(row=i, column=7).value) * 100 for i in range(2, ws.max_row + 1) if isinstance(ws.cell(row=i, column=7).value, (int, float))]
        if not mdds:
            continue
        ours = freq_ts(mdds)
        excel, bad = {}, []
        for i in range(6, 20):
            lab, cnt = ws.cell(row=i, column=2).value, ws.cell(row=i, column=3).value
            if lab and isinstance(cnt, (int, float)):
                key = str(lab).replace(" ", "")
                # 구간 이름과 COUNTIFS 조건이 맞는지 확인(엑셀 수식 복사 오류 검출)
                nums = [float(x) for x in re.findall(r"\d+(?:\.\d+)?", key)]
                cond = [round(float(x) * 100, 6) for x in re.findall(r'"[<>]=?(\d*\.?\d+)"', str(wf[name].cell(row=i, column=3).value))]
                want = [nums[0]] if "이상" in key else ([0.0, nums[0]] if "이하" in key else nums)
                if cond != want:
                    bad.append(key)
                    continue
                excel[key] = int(cnt)
        om = {r["구간"].replace(" ", ""): r["횟수"] for r in ours}
        if "60%이상" in excel:  # 8구간 시트: 웹앱 60~70·70~80·80% 이상을 합쳐 비교
            om["60%이상"] = om.pop("60%~70%") + om.pop("70%~80%") + om.pop("80%이상")
        for k in bad:  # 수식이 구간 이름과 다른 행은 비교에서 빼고 따로 보고
            om.pop(k, None)
            if k == "80%이상":
                om.pop("80%이상", None)
        a_n += 1
        if bad:
            xl_bugs.append({"시트": name, "행": bad})
        if om == excel:
            a_ok += 1
        else:
            a_fail.append(name)
        if ticker in summary:
            b_err.append(abs(sum(mdds) / len(mdds) - summary[ticker]["평균MDD"]))
    b_max = max(b_err) if b_err else None
    prices = ROOT / "private/prices"
    c = price_check(prices, summary_full(wb)) if prices.exists() and any(prices.glob("*.csv")) else {"상태": "보류", "사유": "가격 CSV 없음(private/prices/<종목>.csv, Date·Open·High·Low·Close) — 개발 환경에서 외부 시세 접속 불가"}
    out = {
        "상태": "일치(빈도표·집계)" if a_ok == a_n and b_max is not None and b_max <= TOL else "불일치",
        # 시트(종목) 이름은 사용자의 관심 목록이라 남기지 않는다(개수만)
        "A_빈도표": {"시트수": a_n, "정확히일치": a_ok, "불일치시트수": len(a_fail), "엑셀수식오류시트수": len(xl_bugs), "엑셀수식오류": "구간 이름은 '80% 이상'인데 COUNTIFS 조건이 50~60%인 행(비교에서 제외, 웹앱은 80% 초과를 셈)" if xl_bugs else None},
        "B_평균MDD집계": {"비교수": len(b_err), "최대오차%p": round(b_max, 6) if b_max is not None else None, "허용%p": TOL},
        "C_가격재현": c,
        "정의차이": DEF_DIFF,
        "원본해시": hashlib.sha256(xl.read_bytes()).hexdigest(), "실행시각": now,
    }
    print(json.dumps(out, ensure_ascii=False))
    return 0 if out["상태"].startswith("일치") else 1


if __name__ == "__main__":
    sys.exit(main())
