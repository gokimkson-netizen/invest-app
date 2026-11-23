# 설계 문서

## 0. 추가 확정 사항(개발 중 사용자 결정)
| # | 항목 | 확정 (2026-11-23) |
|---|---|---|
| D17 | 가격 출처 | 주 출처 **Stooq**(C급), 미국 보조 **Tiingo**(B급). 야후·트레이딩뷰는 약관상 자동 수집 금지라 사용 안 함 |
| D18 | 공개 데이터 암호화 | 시세·뉴스 등 재배포가 제한된 데이터를 **배치에서 암호화해 공개**하고 본인 기기에서만 푼다(데이터 키 `DATA_KEY`) |
| D6 결과 | 국내 수급 | KRX 약관 제10조②2호(자동화 수단 수집 금지) → **구현하지 않음**, 화면에 "제공 안 됨" |

## 1. 폴더 구조
```
packages/core/src/      공용 TypeScript 계산 모듈(배치 Node 번들 + 브라우저 Vite 번들, 3-8)
  buffett/              M1 계산·정량 관문·결정표(engine), 입력 조립(assemble)
  mdd/                  M3 통계·백테스트
  news/                 M6 중요도 규칙·묶기·관심종목 표시·해설 검증
  infinite/             M4 Core(규칙 종류 등록부 — 문서 미제공으로 0개)
  m5/  m2/              M5 포지션·100% 검사, M2 근거 수집
  sec/                  companyfacts 정규화, 버크셔 13F 산출
  parse/                원본 파서(Stooq CSV, Tiingo, 공시 HTML, 13F XML, RSS, DART)
  common/               구간 판정, 캘린더, 숫자 검사, 암호화
batch/                  파이썬 수집기(원문만 저장) + calc/cli.ts(공용 모듈로 계산·암호화)
worker/                 Cloudflare Worker(원본 전달만)
web/                    Preact SPA
config/                 공개 설정(universe, source_grades, buffett, llm, news_* , holidays, publish, public)
docs/                   data-sources, design, mdd-definitions, infinite-core-schema
scripts/                publish, assemble_site, make_fixture, check_repo, 로컬 전용 검사
tests/                  e2e(Playwright), parity(Node vs 브라우저)
private/                개인 자료(.gitignore, 커밋 금지)
```
- 프레임워크: Preact 10(약 4KB, 정적 배포, 모바일 성능). 차트·마크다운 외 의존성 최소. 외부 CDN 없음, `package-lock.json`으로 버전 고정.

## 2. 데이터 흐름과 저장 방식
```
[collect 잡]  data 브랜치 checkout → unseal(복호화) → python 수집(원문) → node 계산(공용 모듈) → seal(gzip+AES-GCM) → 아티팩트
[publish 잡]  (concurrency: publish, queue: max) data 브랜치 새로 clone → 자기 소유 경로만 교체 → merge-status → 단일 스냅샷 커밋 강제 푸시(실패 시 재시도 3회)
              → 웹앱 빌드 → site = web/dist + data 브랜치 data/ 전체 → deploy-pages
```
- data 브랜치 = 화면용 JSON + 다음 배치용 상태(`state/`). 최신 스냅샷 단일 커밋만 유지(이력 누적 없음).
- 평문은 `data/_status.json`, `data/status/*.json`(기준일·수집 시각·실패 사유만)뿐. 나머지는 모두 `{"v":1,"alg":"A256GCM","iv","ct","path","z":"gzip"}` 봉투(AAD = 파일 경로).
- **저장 방식 비교**
| 방식 | 장점 | 단점 | 결론 |
|---|---|---|---|
| data 브랜치 단일 스냅샷(채택) | 저장소 크기 일정, 빈 상태 재구성 쉬움, 배포 시 전체 데이터 확보 | 이력 없음 | 채택 |
| 매일 커밋(이력 누적) | 변경 추적 | 1GB 권장 한도 빠르게 접근(시세 수백 MB × 일수) | 기각 |
| 증분 저장(일별 파일 추가) | 전송량 작음 | 파일 수 폭증, 병합 복잡 | 기각 |
| Actions 캐시만 | 간단 | 미사용 시 삭제·용량 한도 | 상태 보관 금지(3-4) |
- 예상 용량(추측입니다): 가격 1종목 ≈ 7,500봉 × gzip 후 약 30~40KB → 미국·ETF 약 620종목 + 코스피 약 950종목 ≈ 60MB. Pages 1GB 한도 내. 실제 값은 첫 배포 후 측정해 이 표를 갱신한다.

## 3. 배치 일정 (UTC / KST)
| 워크플로 | cron(UTC) | KST | 근거 |
|---|---|---|---|
| daily-us | `17 23 * * 1-5` | 다음날 08:17 | 미국장 마감 KST 06:00(EDT)/07:00(EST) 이후, 정각 회피 |
| daily-kr | `17 9 * * 1-5` | 18:17 | 국내장 마감 15:30 이후 |
| news | `7 * * * *` | 매시 7분 | D13(60분), 정각 회피 |
- 휴장일은 `config/holidays.json`(미국 A급·국내 C급 — KRX 공지로 재확인 필요)로 건너뛰고 '휴장' 표시.
- concurrency: 수집 잡 `daily-us`·`daily-kr`·`news`(따로, cancel-in-progress false), publish 잡 공통 `publish`(queue: max → 대기 최대 100개, 취소 없음).
- 뉴스 배치는 하루 약 24회 배포한다. 1회 배포 시간(10분 제한 대비)은 개발 환경에서 측정할 수 없어 **첫 배포 후 Actions 실행 기록으로 측정해 기록**한다(측정 전).

## 4. 처리량 추정(추측입니다 — 첫 실행에서 실측해 11절 4번으로 보고)
| 항목 | 추정 |
|---|---|
| M1 SEC 호출 | submissions 약 600회/일 + companyfacts(새 정기보고서 있을 때만) — 초당 8건 → 약 2~5분. 첫 실행은 companyfacts 600건(대용량)으로 20~40분 |
| Stooq | 약 1,600회/일(미국·ETF·코스피). 비공개 일일 한도 초과 시 남은 종목은 다음 실행 |
| Tiingo | 실행당 최대 40회(무료 시간당 50건) |
| Gemini 배치 요약 | 첫 대기열 약 1,200건(10-K·DEF 14A), 하루 상한 `summary_daily_cap`=100 → 약 12일에 걸쳐 처리. 이후 연 1회 수준(신규 공시만) |
| Gemini 브라우저 | M6 탭 열 때 상위 10건(캐시 후 재호출 없음) + 사용자가 누른 M1·M2·M6 건. 하루 약 10~40건 |
| DART | 국내 M2 목록 950회 + 월 1회 실적 약 950~3,800회 → 하루 2만건 한도 내 |

## 5. 데이터 스키마(주요 파일)
| 파일 | 내용 |
|---|---|
| `data/status/{us,kr,news}.json` | batch, 수집시각UTC, 기준일(현지 거래일), 휴장·사유, 성공 수, 실패[모듈·대상·사유] |
| `data/m3/{us,kr}/index.json` | 종목별 현재 낙폭(52주·전체), 평균MDD·상승률·낙폭, 표본연수, 시작일, 출처·등급 |
| `data/m3/{mkt}/sym/<T>.json` | 수정주가 봉 [날짜, 종가, 고, 저, 거래량], 연도별 통계, 빈도표, 현재 낙폭 |
| `data/m1/index.json`·`sym/<T>.json` | 부록 A-3 입력, 계산값, 정량 관문, 공시 발췌·AI 요약(원문 비교), 버크셔_참고 |
| `data/m2/{mkt}/sym/<T>.json` | 주가·실적·공시 근거(기준일·출처·등급), 수급(제공 안 됨 사유) |
| `data/m6/cards.json` | 묶음 카드, 중요도, 걸린 규칙, 관련 종목·업종, 예상 밖 판정, 경제 일정 |
| `data/shared/us/{rates,berkshire}.json`, `shared/kr/{rates,corp_codes}.json` | 즉시 분석 재사용(금리·13F·종목코드→DART 고유번호) |
| `state/news/runs.json` | 예정 시각 대비 실제 시작 시각(지연 실측) |
| `state/summaries/{queue,count}.json`, `done/` | 공시 요약 대기열·태평양시 일자별 사용량·완료분 |

## 6. 재무 태그 대응표(SEC XBRL → 부록 A-3)
`packages/core/src/sec/facts.ts`의 `TAGS`. 연간 값 = 10-K 계열, 기간 350~380일(시점형은 기말), 같은 기말은 가장 나중 제출값.
- 투하자본 = 지배자기자본 + 이자부부채 − (현금 + 단기투자) / ROIC = 영업이익 × (1 − 실효세율) ÷ 투하자본(실효세율 = 법인세 ÷ 세전이익, 0~50% 제한)
- 감가상각 태그가 무형자산 상각을 포함하면 무형자산상각비 = 0. 이자부부채 태그(`LongTermDebt`·`LongTermDebtNoncurrent`·`LongTermDebtCurrent`·`DebtCurrent`·`LongTermDebtAndCapitalLeaseObligations(Current)`·`ShortTermBorrowings`)가 하나도 없으면 **0으로 간주하지 않고 null**(데이터 없음) → 투하자본·ROIC·부채비율이 계산되지 않아 G4·G5가 판단불가가 될 수 있음(검산 메모 표시, 11절 16번)
- 일회성손익·비영업자산·자사주소각액은 XBRL 구조화 항목이 없어 null → 일회성 제외 없음
- 은행·보험(SIC)의 CET1·대손비용률·합산비율·지급여력비율은 companyfacts에 표준 태그가 없어 **판단불가가 될 수 있음**(11절 보고)

## 7. 운영 기준 해석(코드 구현을 위해 정한 것 — 11절 확인 항목)
1. 증분 ROIC에서 투하자본 증가분 ≤ 0이면 정의 불가 → **'데이터없음'으로 두어 G4 판단불가**(근거에 '증분 ROIC 정의 불가' 표시). 값을 지어내지 않는다(11절 12번)
2. 확신도 '상'의 "핵심 근거 모두 A급"에 **가격 출처 등급**을 포함 → Stooq(C급)를 쓰는 동안 확신도 '상'은 나오지 않음
3. G2 비재무 증거 상향: A·B급 `비재무_해자증거`가 1건 이상이면 '조건부'→'통과'(현재 수집 구조상 대부분 없음)
4. G3 '위기 연도 이익 감소 일시적' = 감소 후 2년 안에 직전 수준 회복. '이익 감소가 2년 넘게 이어짐' = 3년 연속 감소
5. 오너 어닝 낙관 시리즈의 유지 CAPEX = min(총 CAPEX, 감가상각비), 운전자본 증가분은 보수에서만 차감. 운전자본 증가분 태그가 없으면 차감하지 않고 '운전자본 변화 미반영' 표시
6. 어떤 해의 실효세율을 계산할 수 없으면(세전이익 ≤ 0 등) 다른 해들의 평균 실효세율로 대체하고 'ROIC 세율 대체' 표시를 남긴다. 평균도 없으면 그 해 ROIC는 비움(11절 17번)
7. G2의 '형편없는 사업' 유형은 부록 A에 정량 정의가 없어 코드가 따로 판정하지 않는다(ROIC 구간으로만 판정) → "G2 '형편없는' 유형" 데이터부족 표시(11절 18번)
8. 수정주가 변경(분할·배당) 감지 시: 직전 일관 데이터를 유지하고 `needFull`을 저장 → 다음 실행에서 전체 이력 재수집. 서로 다른 기준의 봉을 섞지 않는다

## 8. 화면 구성
- 모바일 하단 탭 5개(홈·중대 뉴스·버핏 분석·MDD·더보기), PC 좌측 메뉴. 모든 화면 결론 우선, 하단 면책 문구.
- 상단 상태 표시줄: 미국·국내 기준일, 휴장, 실패 수, 2거래일 초과 시 빨간 경고.
- 관심종목·M4·M5·설정·Worker 토큰·데이터 키 = IndexedDB(동기화). Gemini 키·PAT·기기 이름 = 이 기기만(동기화 파일의 `기기`는 마지막으로 수정한 기기 이름 기록). 한 번도 동기화하지 않은 기기에 로컬 데이터가 있으면 첫 받기에서 충돌 화면으로 고르게 한다.

## 9. 보안 설계 요약
- CSP `<meta>`: `script-src 'self'`, `connect-src`는 자기 도메인·Gemini·GitHub API·Worker 4곳. meta CSP로는 `frame-ancestors`·`report-uri`·`sandbox`가 적용되지 않는다(README 명시).
- 외부 텍스트: Preact 텍스트 렌더링, 마크다운은 marked → DOMPurify(허용 태그 목록, http(s) 링크만).
- 동기화 암호: PBKDF2-SHA256 60만 회(salt1, 암호 설정 시 생성) → HKDF 기본키(non-extractable, 기기 보관 가능) → 업로드마다 새 salt2·IV로 AES-GCM 키 유도. "솔트와 IV는 매번 새로" 요구와 "유도 키를 non-extractable로 보관" 요구를 함께 만족시키기 위한 2단 구조.
- 로그: URL·헤더·응답 원문 미출력, 마스킹 함수, `set -x`·디버그 로깅 미사용, `pull_request_target` 미사용.

## 10. 3-8 기본안 유지
- 계산은 TypeScript 한 벌. 파이썬은 HTTP 수집(속도 제한·재시도·마스킹)만 하고 파싱·정규화·계산·암호화는 `batch/calc/cli.ts`(공용 모듈 번들)가 한다. 기본안을 바꾸지 않았다.

## 11. 배포 후 실측 기록(README 5-1단계 — 개발 환경에서는 잴 수 없어 비워 둠)
| 항목 | 기준 | 측정일 | 값 | 판정 |
|---|---|---|---|---|
| 뉴스 24시간 실행률 | 90% 이상(추측 기준) | | | |
| 뉴스 최근 24시간 최대 지연 | 60분 이하(추측 기준) | | | |
| 취소된 실행 수(`is:cancelled`) | 0건 | | | |
| 뉴스 배포 뒤 M1·M3 데이터 유지 | 유지 | | | |
| publish 잡 소요(daily-us) | 기록만 | | | |
| publish 잡 소요(daily-kr) | 기록만 | | | |
| publish 잡 소요(news) | 기록만 | | | |
| Worker 캐시(두 번째 요청 x-cache: HIT) | HIT면 동작, 없으면 기록만 | | | |
| daily-us 첫 실행 전체 소요 | 기록만(추정 30분~2시간, 추측입니다) | | | |

