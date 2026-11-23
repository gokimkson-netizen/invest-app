# 통합 투자 참고 웹앱

버핏식 분석(M1), 일일 종목 리포트(M2), MDD 투자참고(M3), 무한매수법 계산기(M4), SOXL 낙폭 매수 연구(M5), 중대 뉴스(M6)를 폰·PC에서 쓰는 하나의 웹앱으로 묶었습니다. 모든 화면은 **투자 권유가 아닌 참고 자료**입니다.

> **명령어 표기 규칙**: 이 문서의 명령어는 띄어쓰기를 `_`로 적었습니다. 직접 입력할 때 `_` 자리에 **띄어쓰기 한 칸**을 넣으세요. 예: `git_add_.`는 git, 한 칸, add, 한 칸, 점(.)으로 입력합니다. (단, 파일 이름 안의 `_`는 그대로입니다. 그런 곳은 따로 표시했습니다.)

## 기술 선택
화면은 **Preact + Vite**로 만들었습니다. Preact는 약 4KB의 작은 라이브러리라 폰에서 빨리 열리고, 결과물이 정적 파일이라 GitHub Pages에 무료로 올릴 수 있습니다. 외부 CDN 스크립트는 쓰지 않고 모든 의존성을 묶어(번들) 버전을 고정했습니다(`package-lock.json`). 계산 로직은 TypeScript 한 벌(`packages/core`)을 배치(Node)와 브라우저가 함께 써서 결과가 같습니다. 데이터 수집은 Python, 수집 일정은 GitHub Actions, 유니버스 밖 즉시 분석은 Cloudflare Workers 무료 플랜이 맡습니다.

## 꼭 알아야 할 것
- **GitHub 무료 요금제의 Pages는 공개 저장소에서만 됩니다.** 저장소·커밋·Actions 로그·사이트가 모두 공개입니다. 그래서 개인 정보(보유 수량·평단·총자산·매매 기록·관심종목·키)는 저장소에 넣지 않고 **각 기기 브라우저(IndexedDB)**와 **암호화된 비공개 동기화 저장소**에만 둡니다.
- 시세·뉴스는 출처 약관상 공개 재배포가 금지되어, 배치가 **데이터 키로 암호화해서** 올립니다. 공개된 것은 암호문뿐이고, 본인 기기에서 데이터 키를 넣어야 보입니다.
- **국내 투자자별 수급은 제공하지 않습니다.** KRX 이용약관이 자동화 수단으로 정보를 수집하는 것을 금지합니다(제10조②2호).
- 무한매수법 V4.0 문서가 아직 반영되지 않아, M4는 **"규칙 미입력 — 무한매수법 문서 필요"**만 표시합니다(규칙을 지어내지 않음).
- 중대 뉴스는 **준실시간(60분 간격)**입니다. 실제 지연은 수십 분까지 가능합니다.

---

## 1단계. 키·계정 준비 (모두 무료)
아래 값을 메모장에 모아 두세요. **메모는 다른 사람에게 보내지 마세요.**

| 이름 | 어디서 | 메모 |
|---|---|---|
| SEC 연락처 | 본인 이름 + 이메일 | 배치용 예: `Hong_hong@example.com` 형식(띄어쓰기 한 칸). Worker용은 **다른 이메일**(가능하면 별칭)을 쓰세요. SEC는 이메일 단위로 차단할 수 있습니다 |
| OpenDART 키 2개 | opendart.fss.or.kr → 인증키 신청 | 배치용 1개, Worker용 1개. 계정당 1개만 발급되면 Worker용 국내 즉시 분석은 비워 두세요(보고 항목) |
| FRED 키 | fred.stlouisfed.org → My Account → API Keys | |
| ECOS 키 | ecos.bok.or.kr → 인증키 신청 | |
| Gemini 키 2개 | aistudio.google.com → Get API key | **서로 다른 Google Cloud 프로젝트**에서 하나씩(배치용·브라우저용). 프로젝트에 **결제 계정을 연결하지 마세요**(연결하면 유료로 바뀌어 과금될 수 있음). 키 제한에서 "Generative Language API"만 허용 |
| Stooq API 키 | stooq.com → 시세 CSV 다운로드 화면에서 캡차 후 발급 | 가격 주 출처 |
| Tiingo 토큰 | tiingo.com → 무료 가입 → API | 미국 가격 보조(무료는 시간당 50건) |
| 데이터 키 | 2단계 4번에서 내 PC로 만듭니다 | 4단계 Secrets의 `DATA_KEY`와 8단계 앱 설정 "데이터 키"에 **같은 값** |
| (선택) Wikipedia 연락처 | 본인 이메일 또는 연락 가능한 웹 주소 | 비워 두면 SEC 연락처를 씁니다. Wikimedia 정책상 연락처가 있어야 합니다 |

## 2단계. 1회 업로드 (내 PC)
1. git 설치: git-scm.com 에서 설치 프로그램을 받아 기본값으로 설치합니다. 설치 뒤 명령 창(Windows는 "Git Bash")을 엽니다.
```cmd
git_--version
```
정상이면 "git version 2.xx" 같은 글자가 보입니다.

2. Node.js 설치: nodejs.org 에서 **LTS** 버전을 받아 기본값으로 설치합니다. 명령 창을 닫았다가 다시 엽니다.
```cmd
node_--version
```
정상이면 "v22.xx"처럼 v로 시작하는 숫자가 보입니다(20 이상이면 됩니다).

3. GitHub 로그인 도구 설치: cli.github.com 에서 GitHub CLI를 설치합니다.
```cmd
gh_auth_login
```
질문에 GitHub.com → HTTPS → 브라우저로 로그인 순서로 고르면 "Logged in as 아이디"가 보입니다.

4. 받은 프로젝트 폴더로 이동하고(폴더 경로는 본인 PC에 맞게) **데이터 키**를 만듭니다.
```cmd
cd_invest-app
```
```cmd
node_scripts/new_data_key.mjs
```
(`new_data_key.mjs`의 `_`는 파일 이름이라 그대로) 44글자 정도의 값이 한 줄 나옵니다. 메모장에 복사해 두세요. 파일로는 저장되지 않습니다. **다른 사람에게 보내지 마세요.**

5. 커밋에 남을 이름·이메일을 정합니다. 저장소가 공개라 **커밋 이메일도 공개**됩니다. 개인 이메일 대신 GitHub의 비공개용 주소를 쓰세요: GitHub → Settings → Emails → "Keep my email addresses private" 켜기 → 그 아래 보이는 `숫자+아이디@users.noreply.github.com` 주소를 복사합니다.
```cmd
git_config_--global_user.name_"내아이디"
```
```cmd
git_config_--global_user.email_"숫자+아이디@users.noreply.github.com"
```
(`user.name`, `user.email`, 주소 안의 `+`·`.`은 그대로입니다)

6. GitHub에서 **공개** 저장소를 만듭니다(예: `invest-app`). README 추가 같은 옵션은 모두 끄세요.

7. 폴더를 git 저장소로 만듭니다.
```cmd
git_init
```
정상이면 "Initialized empty Git repository"가 보입니다.

8. 개인 자료가 빠졌는지 확인합니다. 아래 명령 결과에서 `private/`는 앞에 `!!`(제외됨)로만 보여야 하고, `??`나 `A`로 보이면 안 됩니다.
```cmd
git_status_--short_--ignored
```
`private/` 폴더가 비어 있으면 아예 안 보일 수도 있습니다(정상).

9. 올리기
```cmd
git_add_.
```
```cmd
git_commit_-m_"first_upload"
```
(따옴표 안의 `_`도 띄어쓰기입니다 → 따옴표 안은 first, 한 칸, upload)
```cmd
git_branch_-M_main
```
```cmd
git_remote_add_origin_https://github.com/내아이디/invest-app.git
```
```cmd
git_push_-u_origin_main
```
정상이면 마지막 줄에 "main -> main"이 보입니다. `node_modules`와 빌드 결과물은 올라가지 않습니다(빌드는 Actions가 합니다).

## 3단계. Pages 켜기
저장소 → Settings → Pages → Build and deployment → Source를 **GitHub Actions**로 바꿉니다. 저장 버튼은 없습니다(선택하면 바로 반영).

## 4단계. Secrets 등록
저장소 → Settings → Secrets and variables → Actions → New repository secret. 이름은 **정확히** 아래와 같이 씁니다.

| 이름 | 값 |
|---|---|
| `SEC_USER_AGENT` | 배치용 "이름 이메일" |
| `OPENDART_KEY` | 배치용 OpenDART 키 |
| `FRED_KEY` · `ECOS_KEY` | 각 키 |
| `GEMINI_API_KEY` | **배치용** Gemini 키 |
| `STOOQ_APIKEY` · `TIINGO_TOKEN` | 각 키 |
| `DATA_KEY` | 2단계 4번에서 만든 데이터 키 (없으면 배치가 "DATA_KEY 비밀값이 없습니다"로 바로 멈춥니다) |
| `WIKI_USER_AGENT` (선택) | 예: `invest-app/1.0_(내이메일@example.com)` — 비워 두면 SEC 연락처를 씁니다 |

## 5단계. 첫 실행
1. Actions 탭 → 왼쪽 `daily-us` → Run workflow → Run workflow. 첫 실행은 전체 가격 이력과 재무를 받으므로 오래 걸립니다(추측입니다: 30분~2시간).
2. 끝나면 `daily-kr`, `news` 순서로 같은 방법으로 실행합니다.
3. 사이트 주소 `https://내아이디.github.io/invest-app/` 를 엽니다 → 설정 → "데이터 키"에 2단계 4번 값을 넣고 저장합니다. 화면에 기준일과 데이터가 보이면 정상입니다.

**첫 실행 점검표** (개발 환경에서는 외부 출처에 접속할 수 없어 실제 응답은 첫 실행에서 처음 확인됩니다)
- 화면 상단에 미국·국내 기준일이 보이는가
- MDD 화면에서 국내 종목이 "데이터 없음(Stooq 국내 미지원 가능성)"이면 → Stooq가 국내 종목을 지원하지 않는 것입니다(보고 항목)
- 홈 "데이터 상태"의 실패 건수와 사유(Actions 실행 화면 → `collect` → 로그에는 URL·키가 나오지 않습니다)
- Actions 로그 검사: 실행 화면 → ⋯ → Download log archive → 압축을 푼 뒤
```cmd
python_scripts/check_logs.py_로그폴더
```
(`check_logs.py`의 `_`는 파일 이름이라 그대로) "노출 없음"이 보이면 정상입니다.

## 5-1단계. 배포 후 검증(첫 실행 다음 날 1회, 결과는 `docs/design.md` 11절 표에 적기)
개발 환경에서는 GitHub 서버의 실제 지연·배포 시간을 잴 수 없어, 배포 후 아래를 직접 확인합니다.
1. **뉴스 24시간 실행률·지연**: 앱 → 뉴스 화면 위쪽 "최근 지연 ○분 · 24시간 실행률 ○%"를 봅니다. 실행률 90% 이상, 지연 60분 이하가 기준입니다(추측입니다 — GitHub 예약 실행은 부하 때 늦어지거나 건너뛸 수 있음). 같은 값을 Actions 탭 → `news`에서 최근 24시간 실행 개수로도 셉니다.
2. **취소된 실행 0건**: Actions 탭 위 검색창에 `is:cancelled`를 넣고 Enter → 결과가 0건이어야 합니다. 1건이라도 있으면 실행이 서로 밀어낸 것이니 보고하세요.
3. **다른 모듈 데이터 유지**: `news`가 한 번 더 끝난 뒤 앱의 MDD·버핏 분석 화면을 엽니다. 기준일과 목록이 그대로 보여야 합니다(뉴스 배포가 다른 모듈 파일을 지우지 않음).
4. **배포 잡 소요 시간**: Actions → 아무 실행 → `publish` 잡 오른쪽 시간(예: 1m 20s)을 `daily-us`·`daily-kr`·`news` 각각 1번씩 적습니다.
5. 적을 곳: `docs/design.md` "11. 배포 후 실측 기록" 표(GitHub 웹에서 연필 → Commit changes).

## 6단계. 중계 서버(Cloudflare Worker) — 유니버스 밖 즉시 분석
1. dash.cloudflare.com 가입(무료). **결제 수단을 등록하지 마세요.** Workers 무료 플랜은 한도를 넘으면 과금이 아니라 오류(Error 1027)가 납니다. 유료(Paid) 플랜으로 바꾸지 마세요.
2. **내 PC의** 프로젝트 폴더에서 `worker` 폴더 → `wrangler.toml` 파일을 메모장으로 엽니다(파일을 오른쪽 클릭 → 연결 프로그램 → 메모장). `YOUR_GITHUB_ID`를 내 GitHub 아이디로 바꿔 `https://내아이디.github.io`가 되게 하고 저장합니다. 주소 끝에 `/`나 `/invest-app`을 붙이지 마세요.
   - 꼭 PC 파일을 고쳐야 합니다. 배포 명령(5번)은 GitHub가 아니라 **PC에 있는 파일**을 읽습니다. GitHub 웹에서만 고치면 자리표시자 주소로 배포되어 즉시 분석이 모두 거부됩니다.
3. 명령 창에서 프로젝트 폴더로 이동한 뒤:
```cmd
cd_worker
```
```cmd
npx_wrangler_login
```
처음 실행하면 "Need to install the following packages: wrangler… Ok to proceed? (y)"가 나옵니다 → `y`를 누르고 Enter(Cloudflare 공식 배포 도구를 내려받는 것). 브라우저에서 허용을 누르면 "Successfully logged in"이 보입니다.
4. 비밀값 등록(명령마다 값을 물어보면 붙여 넣기). 먼저 **접근 토큰**을 만듭니다(데이터 키와 같은 방법, 단 **다른 값**이어야 함). 프로젝트 폴더(worker의 상위)에서 실행해야 하므로 `cd_..` 후 실행하고 다시 `cd_worker` 합니다.
```cmd
cd_..
```
```cmd
node_scripts/new_data_key.mjs
```
```cmd
cd_worker
```
나온 값을 메모장에 "접근 토큰"으로 적어 두고 아래 첫 명령에 붙여 넣습니다.
```cmd
npx_wrangler_secret_put_ACCESS_TOKEN
```
```cmd
npx_wrangler_secret_put_SEC_USER_AGENT
```
(Worker용 다른 이메일)
```cmd
npx_wrangler_secret_put_DART_KEY
```
(Worker용 OpenDART 키)
```cmd
npx_wrangler_secret_put_STOOQ_APIKEY
```
```cmd
npx_wrangler_secret_put_TIINGO_TOKEN
```
5. 배포
```cmd
npx_wrangler_deploy
```
마지막에 `https://invest-relay.아이디.workers.dev` 주소가 보입니다. 확인: 배포 출력에 `ALLOWED_ORIGIN`이 내 주소로 보여야 합니다(`YOUR_GITHUB_ID`가 보이면 2번을 다시 하고 5번 재실행).
6. **내 PC의** `config/public.json`을 메모장으로 열어 `"worker_url"`의 따옴표 안에 그 주소를 넣고 저장합니다. 그다음 2번에서 고친 `wrangler.toml`과 함께 올립니다(아래 "배포 뒤 수정하는 방법 → 내 PC에서 수정했다면" 4단계를 그대로 따라 하기). 다음 배포부터 화면 보안 정책(CSP)에 그 주소 하나만 허용됩니다.
7. 앱 설정 → "중계 서버 접근 토큰"에 4번의 접근 토큰을 **첫 기기에서 한 번** 넣습니다. 다른 기기에는 동기화로 전달됩니다.
8. 캐시 동작 확인(배포 후 1회): Cloudflare 문서는 Cache API가 커스텀 도메인에서 동작한다고만 적고 있어 workers.dev 주소에서 되는지 직접 확인합니다. 아래 명령을 **두 번** 실행합니다(주소·토큰은 본인 값, `_`는 띄어쓰기).
```cmd
curl_-s_-o_/dev/null_-D_-_-H_"X-Access-Token:_접근토큰"_https://invest-relay.아이디.workers.dev/v1/sec_tickers
```
(`/dev/null`·`/v1/sec_tickers`의 `/`·`_`는 그대로. Windows 명령 프롬프트에서는 `/dev/null` 대신 `NUL`, Git Bash에서는 그대로) 두 번째 결과에 "x-cache: HIT"가 보이면 캐시가 동작합니다. 안 보여도 기능은 정상이며(하루 상한·분당 제한은 그대로), 같은 요청도 매번 원 출처로 가므로 즉시 분석 한도가 조금 빨리 찹니다 → `docs/design.md` 11절 표에 결과를 적어 주세요.
- 토큰은 공개 코드에 없으므로 무작위 남용을 늦추는 효과가 있지만 **완전한 방어는 아닙니다.** Worker에는 IP별·전체 분당 제한과 하루 상한(`DAILY_CAP`)이 있습니다.
- workers.dev 주소만 쓰므로 라우트 fail open/closed 설정은 해당되지 않습니다. 커스텀 도메인을 붙이면 반드시 **fail closed**로 설정하세요.

## 7단계. 기기 간 자동 동기화
1. GitHub에서 **비공개** 저장소를 하나 더 만듭니다(예: `my-invest-sync`). 이 저장소에는 Actions·Pages를 켜지 마세요.
2. GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate. Repository access: Only select repositories → `my-invest-sync` 1개. Permissions: **Contents: Read and write**만. Expiration: 90일 등 만료일 지정.
3. 앱 설정 → 동기화: 저장소 `내아이디/my-invest-sync`, PAT, 동기화 암호, 기기 이름 → "저장·동기화".
- 데이터는 브라우저에서 **암호화한 뒤에만** 올라갑니다(AES-GCM, PBKDF2 60만 회). 저장소에는 암호문만 남습니다.
- PAT는 이 기기 브라우저에 보관됩니다. 화면에 XSS가 생기면 탈취될 수 있습니다(앱은 CSP·새니타이저로 방어). PAT가 새도 권한이 저장소 1개로 제한되고 내용은 암호문입니다.
- **암호를 잊으면 동기화 데이터를 복구할 수 없습니다.** 설정 → 내보내기로 백업하세요.
- Gemini 키와 PAT는 동기화되지 않습니다(기기마다 입력). PAT가 만료되면 동기화만 멈추고 "동기화 토큰 만료 — 새로 발급하세요"가 보입니다.

## 8단계. 폰·PC 설정
각 기기에서 사이트를 열고 설정 → **브라우저용** Gemini 키 입력(이 기기에만 저장), 동기화 설정. 데이터 키·Worker 토큰은 동기화로 들어옵니다.
- Google은 API 키를 클라이언트 코드에 박아 넣지 말라고 권고합니다. 이 앱은 키를 코드에 넣지 않고, 사용자가 자기 기기에 직접 입력하는 개인용 방식입니다.

## 9단계. 무한매수법 규칙 파일(첫 기기에서 한 번)
규칙 파일은 문서 내용이라 **공개 저장소에 올리지 않고** 업로드용 압축과 따로 받습니다(비공개 파일 묶음).
1. 비공개 파일 묶음을 내 PC 프로젝트의 `private` 폴더 안에 풉니다. 이 폴더는 `.gitignore`로 막혀 있어 올라가지 않습니다(2단계 8번 확인 방법으로 다시 확인).
2. 앱 → 더보기 → 무한매수법 → "규칙 파일 불러오기"에서 `private` 폴더의 `infinite_v4.rules.json`을 고릅니다. "규칙 파일 저장됨"이 보이면 정상입니다(형식이 틀리면 이유가 표시되고 저장되지 않음).
3. 종목별 원금을 넣고 "시작" → "첫 매수 할증률"(규칙 파일의 범위 안)과 "사다리 개수"를 직접 정합니다. 앱은 이 두 값에 기본값을 넣지 않습니다.
4. 매일 장 마감 뒤 체결된 주문에 표시하고 실제 체결가를 넣어 "체결 결과 저장"을 누르면 평단·잔금·회차가 갱신됩니다. 주문은 앱이 넣지 않습니다.
5. 다른 기기에는 동기화로 전달됩니다. 문서 예시 검사(개발자용):
```cmd
python3_scripts/check_infinite_mapping.py
```
(`check_infinite_mapping.py`의 `_`는 파일 이름이라 그대로) 마지막에 "일치"가 보이면 정상입니다.

---

## 유니버스(분석 대상) 종목 추가
분석 가능한 종목은 유니버스에 있는 종목뿐입니다. **종목을 추가하면 universe.json에 들어가 공개됩니다.** (관심종목은 앱의 ☆ — 공개되지 않음)
1. GitHub 저장소 → `config` 폴더 → `universe.json` → 연필 아이콘(Edit this file)
2. `"extra":[]`의 대괄호 안에 다음 형식으로 적습니다(띄어쓰기 없이 그대로 복사해도 됩니다): `{"ticker":"035720","name":"카카오","market":"KR"}` (여러 개면 쉼표로 구분)
3. 오른쪽 위 Commit changes → Commit changes
4. 다음 배치부터 반영됩니다. KOSDAQ 종목은 이렇게 직접 추가한 경우에만 분석됩니다. 버핏 분석(M1)은 나스닥100·S&P500 구성종목만 매일 분석합니다.

## 엑셀 가격 재현(선택, 내 PC)
엑셀과 같은 가격으로 다시 계산해 보려면 종목별 일봉 CSV가 필요합니다.
1. 브라우저에서 stooq.com → 종목 검색(예: 미국 종목은 `qqq.us`) → Historical data → 기간 전체, Daily → Download data in csv file(CSV에 Date·Open·High·Low·Close가 들어 있음). 다운로드에 캡차·키 입력을 요구하면 화면 안내대로 합니다(1단계 Stooq 키와 같은 방식).
2. 파일 이름을 엑셀 종목 이름으로 바꿔(예: `QQQ.csv`) 프로젝트의 `private/prices` 폴더에 넣습니다(이 폴더도 업로드되지 않음).
3. 실행:
```cmd
python3_scripts/excel_check.py
```
(`excel_check.py`의 `_`는 파일 이름이라 그대로) 결과의 C 항목에 일치 여부와 최대 오차가 나옵니다. Stooq 가격은 배당 조정 기준이 엑셀(GOOGLEFINANCE)과 달라 오차가 날 수 있으며, 그 차이는 가격 기준 차이입니다.

## 뉴스 수집 간격 바꾸기
1. `.github/workflows/news.yml` 편집 → `cron:_'7_*_*_*_*'`의 첫 숫자는 분입니다(매시 7분). 30분마다면 `'7,37_*_*_*_*'` (여기서도 `_`는 띄어쓰기)
2. 정각(0분)은 GitHub 부하로 늦어지기 쉬우니 피하세요. 최소 간격은 5분이지만 무료 한도·배포 횟수를 생각해 30분 이상을 권합니다.
3. Commit changes

## 배치가 멈췄을 때(오래된 데이터 경고)
- 공개 저장소는 **60일 동안 활동이 없으면 예약 워크플로가 자동으로 꺼집니다.** data 브랜치 갱신이 활동으로 인정되는지는 GitHub 문서에 명시가 없습니다.
- 다시 켜기: Actions 탭 → 왼쪽 워크플로 이름 → 위에 "This scheduled workflow is disabled…"가 보이면 **Enable workflow**. 그 뒤 Run workflow로 한 번 실행합니다.
- 화면 상단에 빨간 "데이터가 오래됨" 경고가 뜨면 이 절차를 확인하세요.

## 휴장일 갱신(매년 말)
`config/holidays.json`에 다음 해 휴장일을 추가합니다. 미국은 nyse.com Holidays, 국내는 한국거래소 휴장일 공지를 보고 넣습니다(국내 목록은 확실하지 않음 등급 — 공지로 재확인).

## 배포 뒤 수정하는 방법
- 작은 수정: GitHub 웹에서 파일 → 연필 → Commit changes. 자동으로 테스트(ci)가 돌고, 다음 배치 때 사이트에 반영됩니다.
- 한 파일을 GitHub 웹과 PC에서 **동시에** 고치지 마세요. 한쪽에서만 고칩니다.
- 내 PC에서 수정했다면 아래 4개를 순서대로 합니다. 3번(받기)은 GitHub 웹에서 고친 내용(5-1단계 기록 등)을 먼저 받아 와서 올리기가 거부되지 않게 합니다.
```cmd
git_add_.
```
```cmd
git_commit_-m_"update"
```
```cmd
git_pull_--rebase
```
정상이면 "Successfully rebased" 또는 "Current branch main is up to date"가 보입니다. "CONFLICT"가 보이면 같은 파일의 같은 줄을 양쪽에서 고친 것입니다 → 받기를 취소한 뒤, 겹친 줄은 PC 쪽 내용으로 두고 다시 받습니다.
```cmd
git_rebase_--abort
```
```cmd
git_pull_--rebase_-X_theirs
```
(`-X`는 대문자 X. 이 명령에서는 `theirs`가 PC 쪽입니다.) 올리기(아래)가 끝나면 GitHub 웹에서 그 파일을 열어, 웹에서 고쳤던 줄이 빠졌으면 웹에서 다시 고칩니다.
```cmd
git_push
```
정상이면 마지막 줄에 "main -> main"이 보입니다. "rejected"가 보이면 `git_pull_--rebase`부터 다시 합니다.

## 테스트 실행(개발자용)
```cmd
npm_ci
```
```cmd
npm_test
```
```cmd
python3_-m_pytest_-q_batch/tests
```
```cmd
npx_playwright_test
```
```cmd
python3_scripts/check_repo.py
```
(`check_repo.py`, `batch/tests` 의 `_`·`/`는 파일 경로라 그대로)

## 보안 한계
- GitHub Pages는 응답 헤더를 바꿀 수 없어 CSP를 `<meta>`로 넣었습니다. meta CSP로는 `frame-ancestors`(다른 사이트가 이 화면을 틀 안에 넣는 것 막기)·`report-uri`·`sandbox`가 적용되지 않습니다.
- 외부에서 온 텍스트(뉴스 제목·공시 발췌·AI 응답)는 글자로만 표시하고, 마크다운은 검증된 새니타이저(DOMPurify)를 거칩니다.
- Gemini 무료 티어는 입력·응답이 Google 제품 개선에 쓰이고 사람이 검토할 수 있습니다. 그래서 M4·M5 개인 데이터, 관심종목 목록, 보유 여부, '내 관심종목' 여부는 Gemini에 보내지 않습니다.
- Gemini 무료 한도를 넘으면 "무료 한도 초과 — 태평양시 자정(KST 16~17시)에 초기화"가 보입니다. 한도는 키가 아니라 프로젝트 단위입니다.

## 출처 고지
- This product uses the FRED® API but is not endorsed or certified by the Federal Reserve Bank of St. Louis.
- S&P500·나스닥100 구성종목 목록은 Wikipedia(CC BY-SA)에서 수집합니다(C급, 수집 날짜 표시).
- 출처·한도·약관 확인 기록: `docs/data-sources.md`, 설계: `docs/design.md`, 통계 정의: `docs/mdd-definitions.md`.
