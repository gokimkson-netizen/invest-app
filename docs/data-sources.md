# 데이터 출처·한도·약관 확인 기록

- 확인일: **2026-11-23** (개발 시점, 공식 문서 기준)
- 원칙: 확인하지 못했거나 약관상 안 되는 출처는 쓰지 않는다(4-1절). 무료 한도·약관은 바뀔 수 있으므로 배포 전·분기마다 다시 확인한다.
- 등급은 `config/source_grades.json` 하나로 관리한다(출처마다 고정).

## 1. 플랫폼

| 항목 | 확인 내용 | 근거(공식) |
|---|---|---|
| GitHub Pages 한도 | 게시 사이트 최대 1GB, 소스 저장소 권장 1GB, 배포 10분 초과 시 시간 초과, 대역폭 소프트 한도 월 100GB | docs.github.com/pages/getting-started-with-github-pages/github-pages-limits |
| Pages 빌드 한도 | '시간당 10회 빌드' 소프트 한도는 **직접 만든 Actions 워크플로로 빌드·게시하면 적용되지 않음** | 같은 문서 |
| Pages 공개 범위 | GitHub Free에서는 **공개 저장소에서만** Pages 사용 가능 | 같은 문서(기능 대상 안내) |
| Actions 요금 | 공개 저장소의 표준 GitHub 호스팅 러너는 무료. Free 플랜 동시 실행 잡 20개 | docs.github.com/actions/reference/usage-limits-billing-and-administration |
| 예약 실행 | UTC 기준, 기본 브랜치에서만 실행, 부하 시 지연·누락 가능. 공개 저장소는 **60일 동안 저장소 활동이 없으면 예약 워크플로 자동 비활성화** | Actions 문서(usage limits / disabling workflows) |
| 60일 규칙의 '활동' 범위 | **data 브랜치 커밋이 활동으로 인정되는지 공식 문서에 명시 없음 → 확인 불가**. 대응: ① data 브랜치 커밋 유지 ② 화면의 '오래된 데이터' 경고 ③ README에 다시 켜는 절차 | 문서에 정의 없음 |
| concurrency 대기열 | 기본: 그룹당 실행 1 + 대기 1, 새 대기가 기존 대기를 취소. **`queue: max`**(cancel-in-progress가 false이거나 없을 때) 설정 시 그룹당 최대 **100개** 대기 | github.blog changelog 2026-05-07, docs.github.com/actions/reference/limits |
| Actions 캐시 | 일정 기간 미사용 시 삭제·용량 한도 있음 → 상태 보관에 쓰지 않음(data 브랜치 사용) | Actions 캐시 문서 |
| 로그·아티팩트 보존 | 기본 90일, 공개 저장소는 1~90일로 조정 가능 | usage limits 문서 |

## 2. Cloudflare Workers (중계 서버, D8)

| 항목 | 확인 내용 |
|---|---|
| 무료 한도 | 하루 100,000 요청(UTC 자정 초기화), 요청당 CPU 10ms, 요청당 하위 요청 50개, 메모리 128MB |
| 한도 초과 | 과금이 아니라 **Error 1027** 반환 |
| fail open / closed | **라우트(커스텀 도메인) 모드**에만 해당: fail open = Worker를 건너뛰고 원 경로 통과, fail closed = 1027 페이지. 이 앱은 **workers.dev 주소만 사용**(원 경로 자체가 없음). 커스텀 도메인을 쓰게 되면 반드시 fail closed로 설정 |
| 결제 수단 | Workers Free는 기본 제공 플랜. 무료 한도를 넘으면 "해당 종류 작업이 오류로 실패"(과금 없음). 결제 수단 등록 없이 사용. **유료(Paid) 플랜으로 바꾸지 말 것** |
| KV | 무료 쓰기 하루 1,000건 → 카운터로 쓰지 않음 |
| Durable Objects | 2025-04-07부터 Workers Free에서 **SQLite 기반 DO** 사용 가능. 무료 하루 요청 100,000, 행 쓰기 100,000, 저장 5GB, 초과 시 오류(과금 없음) → **전체 일일 상한 카운터로 사용** |
| Rate Limiting 바인딩 | GA(2025-09-19). period는 10초 또는 60초 → **IP별·전체 분당 제한**에 사용 |
| 환경 변수/비밀값 | Worker당 64개, 개당 5KB |

근거: developers.cloudflare.com/workers/platform/limits, /workers/platform/pricing, /kv/platform/limits, /durable-objects/platform/pricing, /workers/runtime-apis/bindings/rate-limit

## 3. Gemini API

| 항목 | 확인 내용 |
|---|---|
| 한도 단위 | **프로젝트 단위**(키 단위 아님). RPD는 **태평양시 자정** 초기화(KST 16시(서머타임)/17시) |
| 모델별 수치 | 공식 rate-limits 페이지는 수치를 싣지 않고 **AI Studio 화면에서 확인**하도록 안내 → 수치는 기록하지 않음(확인 불가). 사용자는 AI Studio의 Rate limit 화면에서 확인 |
| 모델 | 안정(Stable) Flash 계열: `gemini-3.8-flash`, `gemini-3.6-flash`, `gemini-3.5-flash-lite`, `gemini-3.1-flash-lite`. 공식 문서가 새 프로젝트에 3.5 Flash-Lite 또는 3.8 Flash를 권장 → 기본값 `gemini-3.5-flash-lite`(`config/llm.json`에서 변경) |
| 무료 데이터 이용 | 무료(Unpaid) 서비스의 입력·출력은 Google 제품 개선에 쓰일 수 있고 **사람 검토자가 읽을 수 있음** → 개인 데이터 전송 금지(6절) |
| 유료 전환 | 프로젝트에 **활성 결제 계정이 연결되면 유료 서비스**로 취급 → 결제 계정 연결 금지 |
| 429 | 한도 초과 시 429 RESOURCE_EXHAUSTED |

근거: ai.google.dev/gemini-api/docs/rate-limits, /docs/models, ai.google.dev/terms

## 4. 데이터 출처

| 데이터 | 출처 | 등급 | 한도·조건 | 약관 확인 결과 | 사용 |
|---|---|---|---|---|---|
| 미국 재무·공시·13F·Form 4·13D/G | SEC EDGAR (data.sec.gov, www.sec.gov) | A | **초당 10건 이하**, User-Agent에 이름·이메일 필수. data.sec.gov는 CORS 미지원 | 자동 접근은 정책 범위 내 허용(봇넷·크롤링 금지) | 사용 |
| 국내 재무·공시 | OpenDART | A | 키당 하루 약 20,000건(초과 시 상태코드 020) | 무료 키, 개인 발급 | 사용 |
| 미국 국채 10년, 환율 | FRED (DGS10, DEXKOUS 등) | A | 수치 한도 미공개, 과도한 대역폭 금지 | 화면에 "This product uses the FRED® API but is not endorsed or certified by the Federal Reserve Bank of St. Louis." 표시 의무, 저작권 표시된 시리즈는 개인 용도 외 사용 금지 | 사용(고지 문구 화면 표시) |
| 국내 국채 10년 | 한국은행 ECOS | A | 공공데이터포털 표기 "이용허락범위 제한 없음". 호출 한도 공식 수치 미확인(제3자 자료에 3분 300건·하루 약 1,000건 언급 — 확실하지 않음) | 무료 키 | 사용(하루 수 건만 호출) |
| 가격(미국·ETF) 주 | **Stooq** CSV (`/q/d/l/?s=..&i=d&apikey=..`) | C | 2026년 3월부터 apikey 필요(캡차로 발급). 하루 호출 한도 비공개 | 약관 5.3조: **사이트 데이터의 재배포는 Stooq 동의 없이 금지**. 자동 접근 조항은 없음 | **사용(D17) — 공개 파일은 암호화(D18)** |
| 가격(미국) 보조 | **Tiingo** EOD API | B | 무료: 시간당 50건·하루 1,000건·월 1GB, **내부 사용 전용** | 재배포는 별도 라이선스 필요 | 보조로 사용(D17), 암호화(D18) |
| 가격(국내) | Stooq | C | 국내 종목 지원 여부 **개발 환경에서 확인 불가**(robots 차단) | 위와 같음 | 첫 배치에서 확인. 미지원이면 '데이터 없음(출처 미지원)' |
| 가격(BTC) | Stooq `btcusd` | C | 위와 같음 | 위와 같음 | 사용 |
| 코스피 구성종목 | OpenDART 고유번호(corpCode) + 기업개황 `corp_cls=Y`(유가증권시장) | A | DART 한도 내(월 1회 갱신) | — | 사용 |
| S&P500·나스닥100 구성종목 | 무료 공식 목록 없음 → **Wikipedia** "List of S&P 500 companies"·"Nasdaq-100" 구성종목 표(MediaWiki Action API `action=parse`, 하루 2건·직렬·1초 간격) | C | Wikimedia API 사용 정책(2024-08-26 개정): User-Agent 정책·로봇 정책·API Etiquette 준수, 속도 제한 지시 따르기. 2026년 3월부터 익명 요청 전역 속도 제한, 4월부터 식별된 요청도 제한(확인일 2026-11-23, A급: meta.wikimedia.org·mediawiki.org) | User-Agent에 **연락처(이메일·URL) 필수**, 없으면 예고 없이 차단 가능 → `WIKI_USER_AGENT` 또는 SEC 연락처 사용. 내용 라이선스 CC BY-SA 4.0 → 화면에 출처·라이선스·수집일 표시. 450개(S&P500)·90개(나스닥100) 미만이면 표 형식 변경으로 보고 직전 목록 사용 | 사용 |
| 국내 투자자별 수급 | KRX 정보데이터시스템 | — | — | **이용약관 제10조②2호: "자동화 수단을 이용하여 정보를 무단 수집·복제·배포하는 행위" 금지**, 제12조②: 사전 허락 없는 복사·복제·배포·전송·공중송신 금지 | **구현하지 않음(D6 규정)** |
| 야후(yfinance) | — | — | — | Yahoo 약관이 자동화 수단에 의한 데이터 수집 금지 | 사용 안 함 |
| 트레이딩뷰 | — | — | 무료 공개 시세 API 없음 | 자동 데이터 수집 금지, 시세는 표시 전용(비표시 사용 금지) | 사용 안 함 |
| 공공데이터포털 주식시세 | 금융위원회_주식시세정보 | — | — | 공공누리 제4유형(상업적 이용·변경 금지, 재배포 금지), 수정주가 미명시 | 사용 안 함 |
| CUSIP→티커 매핑 | 무료 공식 매핑 없음 → SEC company_tickers.json 이름 대조 + `config/cusip_overrides.json` | C | — | — | 사용(C 표시) |

### 4-1. 뉴스(M6) 출처

| 출처 | RSS·API | 등급 | 약관·재게시 | 사용 |
|---|---|---|---|---|
| 미 연준 보도자료 | RSS 있음 (`federalreserve.gov/feeds/press_monetary.xml`, `press_all.xml`) | A | 공공 정부 자료 | 사용 |
| 미 노동통계국(BLS) 발표 일정 | 공식 일정표(CPI·고용) | A | 공공 정부 자료 | 일정표만 `config/econ_calendar.json`에 반영 |
| FOMC 일정 | 공식 캘린더(2026·2027, 2027은 잠정) | A | — | `config/econ_calendar.json` |
| 한국은행 금통위 일정 | 2027년 개최 예정일 의결(2026-10-29) — 언론 보도로 확인(B), 한은 공식 페이지는 개발 환경에서 본문 확인 불가 | B | — | `config/econ_calendar.json`(B 표시) |
| SEC 8-K | EDGAR 최신 공시 피드 1건(atom) → 유니버스로 필터 | A | — | 사용 |
| DART 주요사항보고서·공정공시 | `list.json` 1회 호출 → 유니버스 필터 | A | — | 사용 |
| BEA·재무부·기재부·금융위·통계청 RSS | 제공 여부·약관 **개발 환경에서 미확인** | — | — | 기본 비활성(`config/news_sources.json` `enabled:false`), 확인 후 켬 |
| 주요 언론 RSS | 매체별 약관 **미확인** | B(매핑) | 매체별 재게시 허용 여부 미확인 → 허용 확인 전 '제목·링크만' | 기본 비활성 |

- 뉴스는 제목·출처·링크·발행 시각·공식 요약만 저장하고 본문은 저장하지 않는다. 최근 7일치만 보관하며, 공개 파일은 암호화한다(D18).

## 5. 보안 관련 기준

| 항목 | 기준 |
|---|---|
| PBKDF2 | OWASP Password Storage Cheat Sheet: PBKDF2-HMAC-SHA256 **600,000회 이상** → 앱 기본 600,000 |
| 암호 | Web Crypto AES-GCM(256bit), 솔트 16바이트·IV 12바이트 매번 새로 생성 |

## 6. 개발 환경 제약 (정직한 기록)

- 이 개발 환경의 셸은 외부 데이터 출처(SEC·DART·Stooq·Tiingo·FRED·ECOS·Gemini·Cloudflare)에 **직접 접속할 수 없다**(허용 목록 제한). 따라서 수집기는 **응답 형식 픽스처로 단위 테스트**했고, 실제 호출 검증은 배포 후 첫 실행에서 한다(README '첫 실행 점검표').
