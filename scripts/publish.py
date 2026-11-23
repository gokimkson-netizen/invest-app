"""publish 잡: data 브랜치를 새로 받아 자기 모듈 파일만 바꾸고 강제 갱신 단일 커밋으로 올린다(3-4).

- 대기가 끝난 뒤(concurrency 'publish', queue: max) 실행되므로 다른 워크플로와 동시에 돌지 않는다.
- 소유 경로(config/publish.json)가 이번 결과물에 있을 때만 교체한다(휴장일 등으로 없으면 기존 유지).
- 푸시 실패 시 다시 받아서 재시도(최대 3회).
- 출력에는 URL·토큰을 남기지 않는다.
"""
import argparse
import json
import shutil
import subprocess
import sys
import os
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def run(cmd, cwd=None, check=True):
    r = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)
    if check and r.returncode != 0:
        raise RuntimeError(f"명령 실패: {cmd[0]} {cmd[1] if len(cmd) > 1 else ''} (code {r.returncode})")
    return r


def apply_owned(job: str, incoming: Path, data: Path) -> list[str]:
    owners = json.loads((ROOT / "config/publish.json").read_text(encoding="utf-8"))["owners"][job]
    changed = []
    for rel in owners:
        src, dst = incoming / rel, data / rel
        if not src.exists():
            continue  # 이번 결과에 없으면 기존 유지
        if dst.exists():
            shutil.rmtree(dst) if dst.is_dir() else dst.unlink()
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(src, dst) if src.is_dir() else shutil.copy2(src, dst)
        changed.append(rel)
    return changed


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--job", required=True)
    ap.add_argument("--incoming", required=True)
    ap.add_argument("--repo-url", required=True)
    ap.add_argument("--data-dir", default="_data")
    a = ap.parse_args(argv)
    data = Path(a.data_dir)
    for attempt in range(3):
        if data.exists():
            shutil.rmtree(data)
        # data 브랜치가 '실제로 없을 때만' 빈 상태로 시작한다. clone 실패(네트워크·인증 오류)는 빈 상태로 덮어쓰지 않고 재시도·실패로 끝낸다.
        ls = run(["git", "ls-remote", "--exit-code", "--heads", a.repo_url, "data"], check=False)
        if ls.returncode == 2:  # 원격 접속은 됐고 data 브랜치가 없음
            data.mkdir(parents=True)
            run(["git", "init", "-q", "-b", "data"], cwd=data)
            run(["git", "remote", "add", "origin", a.repo_url], cwd=data)
        elif ls.returncode != 0:
            print(f"[publish] 원격 확인 실패(code {ls.returncode}) — 다시 시도 ({attempt + 1}/3)")
            time.sleep(float(os.environ.get('PUBLISH_RETRY_SEC', '5')) * (attempt + 1))
            continue
        else:
            r = run(["git", "clone", "-q", "--depth", "1", "--branch", "data", a.repo_url, str(data)], check=False)
            if r.returncode != 0:
                print(f"[publish] data 브랜치 받기 실패 — 다시 시도 ({attempt + 1}/3)")
                time.sleep(float(os.environ.get('PUBLISH_RETRY_SEC', '5')) * (attempt + 1))
                continue
        changed = apply_owned(a.job, Path(a.incoming), data)
        run(["node", str(ROOT / "batch/calc/dist/cli.mjs"), "merge-status", str(data)])
        run(["git", "config", "user.name", "github-actions[bot]"], cwd=data)
        run(["git", "config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com"], cwd=data)
        # 이력이 쌓이지 않도록 최신 스냅샷 단일 커밋
        run(["git", "checkout", "-q", "--orphan", "snapshot"], cwd=data)
        run(["git", "add", "-A"], cwd=data)
        run(["git", "commit", "-q", "-m", f"data snapshot ({a.job})"], cwd=data, check=False)
        run(["git", "branch", "-M", "data"], cwd=data)
        p = run(["git", "push", "-q", "-f", "origin", "data"], cwd=data, check=False)
        if p.returncode == 0:
            print(f"[publish] 완료: {a.job} 교체 경로 {len(changed)}개")
            return 0
        print(f"[publish] 푸시 실패 — 다시 받아 재시도 ({attempt + 1}/3)")
        time.sleep(float(os.environ.get('PUBLISH_RETRY_SEC', '5')) * (attempt + 1))
    print("[publish] 3회 실패 — 데이터를 덮어쓰지 않고 종료", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
