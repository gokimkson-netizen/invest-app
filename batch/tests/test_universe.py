"""Wikipedia 구성종목: User-Agent 연락처, 표 이상 감지, 첫 실행 실패 처리"""
from batch.common.core import Failures, write_json
from batch.collectors import universe


def table(n):
    rows = "".join(f"<tr><td>T{i:03d}</td><td>Co {i}</td><td>Tech</td><td>{i}</td></tr>" for i in range(n))
    return {"parse": {"text": f'<table id="constituents"><tr><th>Symbol</th><th>Security</th><th>GICS Sector</th><th>CIK</th></tr>{rows}</table>'}}


class W:
    def __init__(self, n): self.n, self.calls = n, 0
    def get_json(self, url, params=None):
        self.calls += 1
        return (table(self.n[params["page"]]), None) if isinstance(self.n.get(params["page"]), int) else (None, "HTTP 503")


def test_user_agent_has_contact(monkeypatch):
    monkeypatch.delenv("WIKI_USER_AGENT", raising=False); monkeypatch.delenv("SEC_USER_AGENT", raising=False)
    assert universe.wiki_user_agent() is None
    monkeypatch.setenv("SEC_USER_AGENT", "Kim kim@example.com")
    ua = universe.wiki_user_agent()
    assert ua.startswith("invest-app-batch/1.0 (") and "kim@example.com" in ua
    monkeypatch.setenv("WIKI_USER_AGENT", "my-app/1.0 (https://example.com/contact)")
    assert universe.wiki_user_agent() == "my-app/1.0 (https://example.com/contact)"


def test_first_run_failure_is_reported_and_other_index_kept(tmp_path):
    f = Failures()
    res = universe.resolve(W({"List_of_S&P_500_companies": "fail", "Nasdaq-100": 101}), None, {}, tmp_path, "US", f)
    assert sum("NDX" in u["indices"] for u in res) == 101 and not any("SP500" in u["indices"] for u in res)
    assert any("첫 실행" in i["사유"] for i in f.items if i["대상"] == "SP500")


def test_short_table_uses_previous_list_with_old_date(tmp_path):
    prev = [{"ticker": f"P{i}", "name": "x", "indices": ["SP500"], "구성종목_수집일": "2026-11-01"} for i in range(500)]
    write_json(tmp_path / "state/us/universe.json", prev)
    f = Failures()
    res = universe.resolve(W({"List_of_S&P_500_companies": 12, "Nasdaq-100": 101}), None, {}, tmp_path, "US", f)
    sp = [u for u in res if "SP500" in u["indices"]]
    assert len(sp) == 500 and all(u["구성종목_수집일"] == "2026-11-01" for u in sp)  # 오늘 날짜로 속이지 않음
    assert any("12개뿐" in i["사유"] for i in f.items)


def test_no_contact_skips_request(tmp_path):
    f = Failures()
    universe.resolve(None, None, {}, tmp_path, "US", f)
    assert any("User-Agent" in i["사유"] for i in f.items)
