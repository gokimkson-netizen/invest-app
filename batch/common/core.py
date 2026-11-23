"""배치 공용: 로그 마스킹, HTTP(속도 제한·재시도), 실패 기록, 파일 입출력.

4-4절 로그 보안:
- 요청 URL·요청 헤더·응답 원문을 로그에 출력하지 않는다.
- 예외 메시지는 출력 전에 키·이메일 패턴을 가린다(mask).
- 비밀값은 환경변수(GitHub Secrets)로만 받는다.
"""
from __future__ import annotations

import json
import os
import re
import sys
import threading
import time
from pathlib import Path
from typing import Any, Callable

SECRET_ENVS = [
    "SEC_USER_AGENT", "OPENDART_KEY", "FRED_KEY", "ECOS_KEY", "GEMINI_API_KEY",
    "STOOQ_APIKEY", "TIINGO_TOKEN", "DATA_KEY",
]
_PATTERNS = [
    re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"),            # 이메일
    re.compile(r"(?i)(crtfc_key|api_key|apikey|token|key|auth_key)=([^&\s\"']+)"),  # URL 쿼리 키
    re.compile(r"(?i)(StatisticSearch/)([A-Za-z0-9]+)"),                       # ECOS 경로 키
    re.compile(r"(?i)(x-goog-api-key|authorization)\s*[:=]\s*\S+"),
    re.compile(r"https?://\S+"),                                                # URL 전체
    re.compile(r"\bAIza[0-9A-Za-z_\-]{20,}\b"),                                 # Google API 키 형식
]


def mask(text: Any) -> str:
    s = str(text)
    for name in SECRET_ENVS:
        v = os.environ.get(name)
        if v and len(v) >= 4:
            s = s.replace(v, "[비밀값]")
    for p in _PATTERNS:
        s = p.sub("[가림]", s)
    return s


def log(msg: str) -> None:
    sys.stdout.write("[collect] " + mask(msg) + "\n")
    sys.stdout.flush()


def _hook(exc_type, exc, tb):  # 처리되지 않은 예외도 가려서 출력(스택에 URL이 남지 않게 메시지만)
    sys.stderr.write("[collect] 예외: " + mask(f"{exc_type.__name__}: {exc}") + "\n")


sys.excepthook = _hook


class Failures:
    """한 종목·모듈의 실패가 전체를 멈추지 않게(4-3) 사유만 모은다."""

    def __init__(self) -> None:
        self.items: list[dict[str, str]] = []

    def add(self, module: str, target: str, reason: str) -> None:
        if len(self.items) < 500:
            self.items.append({"모듈": module, "대상": target, "사유": mask(reason)[:200]})

    def dump(self, raw: Path) -> None:
        write_json(raw / "collect_failures.json", self.items)


class RateLimiter:
    """초당 rate건 이하로 제한(토큰 버킷 대신 최소 간격). SEC는 공식 한도 10건/초 → 기본 8건/초."""

    def __init__(self, rate_per_sec: float, clock: Callable[[], float] = time.monotonic, sleep: Callable[[float], None] = time.sleep):
        self.min_interval = 1.0 / rate_per_sec
        self.clock, self.sleep = clock, sleep
        self._last = -1e9
        self._lock = threading.Lock()

    def wait(self) -> None:
        with self._lock:
            now = self.clock()
            delta = self._last + self.min_interval - now
            if delta > 0:
                self.sleep(delta)
                now = self.clock()
            self._last = now


class Http:
    """requests 래퍼. URL·헤더·응답 원문은 로그에 남기지 않는다. 실패는 (None, 사유)로 돌려준다."""

    def __init__(self, user_agent: str | None = None, limiter: RateLimiter | None = None, timeout: int = 60, retries: int = 2):
        import requests  # 지연 import(테스트에서 대체 가능)
        self.s = requests.Session()
        self.s.headers["Accept-Encoding"] = "gzip, deflate"
        if user_agent:
            self.s.headers["User-Agent"] = user_agent
        self.limiter, self.timeout, self.retries = limiter, timeout, retries

    def get(self, url: str, headers: dict | None = None, params: dict | None = None, binary: bool = False):
        reason = "알 수 없음"
        for attempt in range(self.retries + 1):
            if self.limiter:
                self.limiter.wait()
            try:
                r = self.s.get(url, headers=headers, params=params, timeout=self.timeout)
            except Exception as e:  # 네트워크 오류 — 메시지는 마스킹
                reason = "네트워크 오류: " + mask(type(e).__name__)
                time.sleep(1.5 * (attempt + 1))
                continue
            if r.status_code == 200:
                return (r.content if binary else r.text), None
            if r.status_code == 429:
                return None, "속도 제한(429)"
            if r.status_code in (401, 403):
                return None, f"인증/접근 거부({r.status_code})"
            if r.status_code == 404:
                return None, "없음(404)"
            reason = f"HTTP {r.status_code}"
            if r.status_code >= 500:
                time.sleep(2 * (attempt + 1))
                continue
            break
        return None, reason

    def get_json(self, url: str, **kw):
        txt, err = self.get(url, **kw)
        if err:
            return None, err
        try:
            return json.loads(txt), None
        except Exception:
            return None, "JSON 아님"


def read_json(p: Path, default: Any = None) -> Any:
    try:
        return json.loads(Path(p).read_text(encoding="utf-8"))
    except Exception:
        return default


def write_json(p: Path, obj: Any) -> None:
    p = Path(p)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(obj, ensure_ascii=False), encoding="utf-8")


def safe(t: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]", "_", t)


def env(name: str) -> str | None:
    v = os.environ.get(name)
    return v.strip() if v and v.strip() else None


ROOT = Path(__file__).resolve().parents[2]


def config(name: str) -> Any:
    return read_json(ROOT / "config" / name)
