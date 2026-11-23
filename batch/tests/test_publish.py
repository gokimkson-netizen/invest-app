"""10절 27번(배포 전 검증): 로컬 bare 저장소로 publish 잡을 순서대로 실행하는 시나리오."""
import json
import os
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ENV = {**os.environ, "PUBLISH_RETRY_SEC": "0", "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@example.com", "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@example.com"}


def sh(*a, cwd=None):
    return subprocess.run(list(a), cwd=cwd, capture_output=True, text=True, env=ENV)


def wj(p, o):
    p = Path(p); p.parent.mkdir(parents=True, exist_ok=True); p.write_text(json.dumps(o), encoding="utf-8")


def publish(job, inc, url, wd):
    return subprocess.run(["python3", str(ROOT / "scripts/publish.py"), "--job", job, "--incoming", str(inc), "--repo-url", url, "--data-dir", str(wd / "_data")],
                          cwd=wd, capture_output=True, text=True, env=ENV)


def files_on_branch(url, wd):
    d = wd / "check"
    sh("git", "clone", "-q", "--branch", "data", url, str(d))
    return {p.relative_to(d).as_posix() for p in d.rglob("*.json") if ".git" not in p.parts}


def test_sequential_publish_keeps_other_modules(tmp_path):
    bare = tmp_path / "remote.git"
    sh("git", "init", "-q", "--bare", str(bare))
    url = bare.as_uri()
    (tmp_path / "w").mkdir()
    us = tmp_path / "inc_us"
    wj(us / "data/m1/index.json", {"m1": 1}); wj(us / "data/m3/us/index.json", {"m3": 1}); wj(us / "data/status/us.json", {"기준일": "2026-11-20"}); wj(us / "state/us/universe.json", [])
    r = publish("daily-us", us, url, tmp_path / "w")
    assert r.returncode == 0, r.stderr  # data 브랜치가 없던 첫 실행 → 빈 상태에서 시작
    news = tmp_path / "inc_news"
    wj(news / "data/m6/cards.json", {"cards": []}); wj(news / "data/status/news.json", {})
    r = publish("news", news, url, tmp_path / "w")
    assert r.returncode == 0, r.stderr
    f = files_on_branch(url, tmp_path / "w")
    assert {"data/m1/index.json", "data/m3/us/index.json", "data/m6/cards.json", "state/us/universe.json", "data/_status.json"} <= f
    log = sh("git", "--git-dir", str(bare), "log", "--oneline", "data").stdout.strip().splitlines()
    assert len(log) == 1  # 최신 스냅샷 단일 커밋


def test_clone_failure_does_not_overwrite(tmp_path):
    """원격에 접속할 수 없으면 빈 상태로 강제 푸시하지 않고 실패로 끝남"""
    (tmp_path / "w").mkdir()
    inc = tmp_path / "inc"; wj(inc / "data/m6/cards.json", {})
    r = publish("news", inc, (tmp_path / "없는저장소.git").as_uri(), tmp_path / "w")
    assert r.returncode == 1 and "덮어쓰지 않고" in r.stderr


def test_push_rejected_then_retry(tmp_path):
    """첫 푸시가 거부되면 다시 받아서 재시도"""
    bare = tmp_path / "remote.git"
    sh("git", "init", "-q", "--bare", str(bare))
    hook = bare / "hooks/pre-receive"
    marker = tmp_path / "rejected_once"
    hook.write_text(f"#!/bin/sh\nif [ ! -f '{marker}' ]; then touch '{marker}'; echo reject; exit 1; fi\nexit 0\n")
    hook.chmod(0o755)
    (tmp_path / "w").mkdir()
    inc = tmp_path / "inc"; wj(inc / "data/m6/cards.json", {"x": 1})
    r = publish("news", inc, bare.as_uri(), tmp_path / "w")
    assert r.returncode == 0 and "재시도" in r.stdout and marker.exists()
