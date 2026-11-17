# LG ThinQ Induction → Kitchen Hood Automation

Netlify Functions 기반 LG ThinQ 인덕션 × Tuya/Smart Life 스마트 플러그 후드 제어 프로젝트.

> **운영 중단 상태 (2026-11-17)**: Tuya IoT Core Trial 호출량 3% 잔여 경고를 받아 자동화를 중단했습니다. 이 브랜치의 자동화는 기본적으로 비활성화되어 있으며 실제 장치 테스트 없이 활성화하지 마세요.

## 목적과 흐름

매분 Netlify scheduled function이 LG ThinQ에서 인덕션 상태를 확인합니다. 상태를 Netlify Blobs에 저장하고 **목표 후드 상태가 바뀌거나 확인이 필요한 순간에만 Tuya를 호출**합니다.

- 조리 중: 후드 ON 목표
- 조리 종료: **최초 OFF 감지 후 90초** 대기, 그 후 OFF 목표
- 목표 상태와 캐시된 확인 상태가 일치: Tuya 호출 없음
- 최초 실행: Blobs 상태만 초기화하고 제어하지 않음
- 최초 기기 기준값이 필요한 경우 Tuya 상태 1회 조회
- 명령 수락 후 `confirmed=UNKNOWN`: 일정 시간 후 실제 플러그 상태 재확인
- 오류 시 백오프, 연속 3회 명령 실패 후 수동 점검 전까지 중단
- 선택적 저빈도 검증: `TUYA_PERIODIC_VERIFY=true`

⚠ **제약**: Netlify Blobs는 트랜잭션·분산 락을 제공하지 않습니다. 여러 함수가 겹치면 중복 제어 위험이 남아 있습니다. 정확한 횟수 제한/실행 직렬화가 필요하면 Netlify DB/Postgres 또는 단일 큐로 변경해야 합니다. Tuya 토큰 발급·기기 상세 조회 역시 API 사용량을 소비합니다.

## 파일 구조

- `src/automation/engine.ts` — 상태 머신, 종료 지연, 명령 검증 및 재시도
- `src/automation/stateStore.ts` — Netlify Blobs 공유 상태 저장
- `src/tuya/directCommand.ts` — 사전 상태 조회 없는 Tuya 직접 명령
- `src/lg/client.ts`, `src/tuya/client.ts` — LG·Tuya API 클라이언트
- `netlify/functions/scheduled-automation.ts` — 매분 스케줄(기본 비활성화)
- `netlify/functions/hood-automation.ts` — 인증된 수동 평가 POST
- `netlify/functions/tuya-control.ts` — 인증된 수동 명령 POST
- `tests/unit` — 로직 및 안전성 테스트

## 설정

```env
LG_THINQ_PAT=
LG_CLIENT_ID=
LG_DEVICE_ID=
LG_COUNTRY=KR
LG_API_KEY=
LG_API_ENDPOINT=https://thinq-connect.lgthinq.com
TUYA_ACCESS_ID=
TUYA_ACCESS_SECRET=
TUYA_DEVICE_ID=
TUYA_API_ENDPOINT=https://openapi.tuyaus.com

# 안전장치: 명시적으로 true가 아니면 비활성화
AUTOMATION_ENABLED=false
TUYA_COMMANDS_ENABLED=false
MANUAL_AUTOMATION_ENABLED=false
AUTOMATION_ADMIN_TOKEN=
AUTOMATION_BLOB_STORE=home-automation-prod
SHUTDOWN_DELAY_SECONDS=90
CONTROL_RETRY_SECONDS=300
TUYA_PERIODIC_VERIFY=false
TUYA_VERIFY_SECONDS=86400
```

LG/Tuya API 리전 및 키는 실제 계정 설정에 맞게 Netlify 환경 변수로 등록하세요. `.env` 파일이나 비밀키는 커밋하지 마세요. **Blobs 사이트 범위 저장소는 배포 컨텍스트 간 공유**되므로 preview/staging에서는 별도 `AUTOMATION_BLOB_STORE`를 반드시 사용해야 합니다.

## 실행 및 검증

```bash
npm ci
npm run build
npm test -- --runInBand
npm run dev
```

`/api/health`는 GET, `/api/lg-status` 및 `/api/lg-devices`는 GET 조회입니다. `/api/hood-automation`은 이제 **POST**이고 `AUTOMATION_ENABLED`, `MANUAL_AUTOMATION_ENABLED` 및 `x-automation-token` 인증 헤더가 필요합니다. `/api/tuya-control`은 POST `{"on":true|false}`이며 `TUYA_COMMANDS_ENABLED`, `MANUAL_AUTOMATION_ENABLED`와 동일 인증 헤더가 필요합니다. `/api/tuya-status`는 GET이며 수동 조회에도 Tuya 할당량이 소비됩니다.

### 미해결 안전 항목

1. LG 상태 응답 파서가 미지원 응답을 OFF로 해석할 가능성이 있습니다. 실기기 응답 형태를 확인하기 전에는 자동화를 켜지 마세요.
2. Tuya 명령의 성공 응답은 실제 후드 구동 보장이 아닙니다. 전원 복원 시 후드가 자동 작동하는지도 확인해야 합니다.
3. 스케줄 실행 겹침, 수동 명령과 자동 명령의 경합을 엄격히 막으려면 트랜잭션 기반 실행 잠금이 필요합니다.
4. 상태 저장에 실패하거나 명령 응답이 유실되면 실제 기기 상태는 불명확해질 수 있습니다.
5. 자동화 플래그를 활성화하기 전에 빌드·테스트·리소스 사용량과 실제 후드 동작을 검증하세요.

## Tuya API usage monitoring and budget (review branch)

- Set `TUYA_QUOTA_GUARD_ENABLED=true` **only after** verifying Netlify Blobs access. Otherwise all Tuya API calls made through the modified clients fail closed.
- `TUYA_DAILY_API_LIMIT=20` (default): conservative daily request reservation threshold, **including token requests, status reads, and commands** from the modified Tuya clients.
- Usage entries: Netlify Blobs `AUTOMATION_BLOB_STORE` / `tuya-api/YYYY-MM-DD`. Logs contain `tuya_api_attempt_reserved`, attempts and limit. Dates are UTC. These are attempted calls, **not vendor-billed confirmed usage**.
- **Not a strict contractual hard cap:** Blobs has no transactional counter/lock; overlapping invocations and out-of-band API calls can violate the effective limit. A DB transaction or single-writer queue is required for a provable hard cap.
- `TUYA_QUOTA_GUARD_ENABLED`, `AUTOMATION_ENABLED`, `TUYA_COMMANDS_ENABLED` all default disabled. Do not turn any of them on until the CI build, actual-device status mapping, access controls and concurrency strategy are verified.


## Netlify 운영 대시보드

`public/index.html`을 읽기 전용 운영 대시보드로 교체했습니다. `/api/monitor-status`는 `AUTOMATION_ADMIN_TOKEN`을 `x-automation-token` 헤더로 받은 경우에만 상태를 반환합니다. 인증 값이 없으면 503, 일치하지 않으면 401을 반환합니다. 관리자 토큰은 브라우저 메모리에만 두며 저장하지 않습니다.

대시보드 표시 내용:
- 현재 자동화 활성/중지 및 실행 기록 신선도(활성 상태에서 5분 이상 실행 기록 없으면 STALE)
- 마지막 실행 시각과 처리 결과
- LG 인덕션 상태 및 후드 목표 상태/마지막 확인된 플러그 상태
- Tuya 일일 API 요청 **추정량** (`tuya-api/YYYY-MM-DD` in Blobs)
- 최근 실행 이력과 장애별 마지막 발생 시각/횟수

`AUTOMATION_ENABLED=false`인 동안에도 스케줄 함수는 `PAUSED` 실행 기록을 남기지만 **LG/Tuya API에는 접근하지 않습니다**. Netlify가 예약 함수를 실행하지 않으면 해당 기록도 갱신되지 않습니다.

중요: 이 대시보드는 기기의 실제 팬 회전 또는 배기 성능을 측정하지 않습니다. `confirmed`는 Tuya 플러그 상태 확인값이며, Google Home의 실시간 기기 상태와 직접 동기화하지 않습니다. Netlify와 Google Home은 별도의 관측 경로입니다.

기존 Telegram 푸시 대신, 장애는 `incidents/<CODE>`에 집계하고 Netlify 함수 로그에 기록합니다. **자동 푸시 알림은 아직 지원하지 않습니다.** 누구나 접근할 수 있는 일반 페이지에 인증 없는 상태 조회 API를 추가하지 마세요.

### 설정
- `AUTOMATION_ADMIN_TOKEN`: 충분히 긴 임의의 고유 문자열 (Netlify Functions 환경 변수에 등록, Git에 커밋 금지)
- `AUTOMATION_BLOB_STORE`: site-wide 상태 저장 이름. production과 preview에서 분리해야 합니다
- `AUTOMATION_ENABLED=false`, `TUYA_COMMANDS_ENABLED=false`: 기본값 유지, 기능 검증 전 활성화 금지

테스트: `npm ci && npm run build && npm test -- --runInBand`.

> 현재 의존성의 `@netlify/blobs` v9는 transactional counter를 제공하지 않습니다. 일일 API 수치는 관찰용이며 병렬 실행 시 정확한 하드캡이 아닙니다. 정확한 사용량 예산 및 분산 락은 트랜잭션 DB/단일 워커로 구현해야 합니다.

## 대시보드 안전 ON/OFF (2026-11)

관리자 전용 `POST /api/automation-switch` (`{"enabled":true|false}`, `x-automation-token`)를 추가했습니다.

- **OFF**: Netlify Blobs `control/runtime-switch`에 `enabled:false`를 기록합니다. 후드 플러그 전원 자체는 변경하지 않습니다.
- **ON**: Production에서 `AUTOMATION_ENABLED=true`, `TUYA_COMMANDS_ENABLED=true`, `TUYA_QUOTA_GUARD_ENABLED=true`, `ENABLE_DASHBOARD_ARMING=true`가 *모두* 설정되어야 허용됩니다. 설정이 없으면 HTTP 409이고 자동 제어는 계속 차단됩니다.
- 기본값: Blob 키가 없거나 읽기에 실패하면 OFF(fail closed). 스케줄 및 엔진·수동 제어는 런타임 스위치를 확인합니다.
- 기존 실행 중인 Tuya API 요청을 취소하는 원자적 강제 정지는 불가능합니다. 분산 락·엄격한 API 호출량 상한도 별도 데이터베이스/큐 없이는 보장되지 않습니다.
- **현재 운영 설정에서는 ON이 불가능하도록 유지**합니다. 실기기 동작과 API 한도 문제가 해결된 뒤 별도 운영 승인 필요.
- Netlify가 환경 변수 변경 요청에 HTTP 403을 반환하면 이 기능으로 권한 문제가 해결되지는 않습니다. 플러그인 앱 권한과 Netlify 액세스 권한을 별도로 확인해야 합니다.

### ON 버튼이 잠기는 경우 (2026-11-17 수정)

Netlify Functions 런타임에서 `CONTEXT`는 문서상 보장되지 않습니다. 따라서 `SITE_ID`, `URL` (공식 read-only 런타임 변수) 및 요청 Host가 운영 사이트와 일치하는지 확인합니다. `CONTEXT`가 존재할 때만 추가 검사합니다. 배포 프리뷰에서는 활성화할 수 없습니다.

대시보드가 `armingBlockers`를 보여주며 각각의 비활성화 조건을 구분합니다. `partialData=true`이면 ON 버튼을 잠그는 설정은 유지합니다. 관리자 인증 없이는 이 진단 정보를 반환하지 않습니다.

### Netlify Blobs Lambda Compatibility Fix

All existing named `handler` functions use the Lambda compatibility format, which does **not** automatically connect Netlify Blobs. Each function needing Blobs now invokes `connectLambda(event)` before accessing `getStore()`. The scheduled function initializes it at the start of each invocation. The runtime switch stays fail-closed until a valid persisted ON state exists.

The diagnostic logs now emit only error class and operation, never tokens or provider error messages. After deploying, inspect `scheduled-automation` logs for `netlify_blobs_error` and check whether the dashboard displays valid monitoring history. Do not arm automation until this succeeds and the Tuya trial quota is verified.

### 2026-11-17 BlobsConsistencyError 대응

Netlify Blobs의 `strong` 읽기는 Functions 런타임에서 `uncachedEdgeURL`이 제공되지 않아 `BlobsConsistencyError`가 발생했습니다. 모니터링 기록, 장애 기록, 상태 관측 저장소는 `eventual` 모드로 전환했습니다. 값 갱신의 전파에는 최대 60초가 걸릴 수 있습니다.

**자동화 ON은 코드 레벨에서 잠겨 있습니다.** 변경된 OFF 스위치가 모든 인스턴스에 즉시 반영된다는 보장이 없고, Tuya API 일일 시도 횟수 역시 Blobs의 read-modify-write 방식이므로 동시 호출 시 엄격히 제한할 수 없습니다. 이 프로젝트는 운영자 승인 여부와 관계없이 실제 LG/Tuya 제어를 시작하지 않습니다. 즉시 중단·호출량 엄격한 제한이 필요한 경우 트랜잭션 기반 저장소와 단일 실행 경로로 교체해야 합니다.

관리자 대시보드에서는 `RUNTIME_INTERLOCK_STRONG_CONSISTENCY_UNAVAILABLE`을 ON 차단 사유로 표시합니다. OFF 요청은 저장만 수행하며 기기 플러그를 직접 변경하지 않습니다.

## 배포 단위 자동화 재개 경로 (2026-11-17)

Netlify Blobs가 `eventual` 일관성만 제공하는 현재 배포에서는 Blob 기반 실시간 ON/OFF를 기기 명령의 승인 수단으로 사용하지 않습니다. **관리자 대시보드의 ON/OFF는 deploy 모드에서 명시적으로 409를 반환**하여 즉시 중단인 것처럼 오해하지 않게 합니다.

기본적으로 실제 장치 호출은 차단됩니다. 재개 준비를 위해서는 별도 운영 승인과 Tuya Trial 잔여 할당량 재확인 후 Netlify Functions 스코프에서 아래 값을 설정하고 **새 운영 배포**를 만들어야 합니다.

```env
AUTOMATION_CONTROL_MODE=deploy
AUTOMATION_RESTART_APPROVED=true
TUYA_TRIAL_QUOTA_VERIFIED=true
AUTOMATION_ENABLED=true
TUYA_COMMANDS_ENABLED=true
TUYA_QUOTA_GUARD_ENABLED=true
TUYA_DAILY_API_LIMIT=10
```

설정 예시는 **자동 실행 권장이나 즉시 설정 지시가 아닙니다**. 아직 Tuya 잔여 할당량과 LG 상태 파서의 실제 기기 검증이 완료되지 않았습니다. `TUYA_DAILY_API_LIMIT`는 1~20 범위로 강제하며, 현재 Blobs 기반 카운터는 **근사치일 뿐 엄격한 상한이 아닙니다**. 1분 스케줄과 중복/병렬 호출에서 초과 가능성이 남아 있습니다. 엄격한 카운터가 필요하면 트랜잭션 DB나 단일 큐가 필요합니다.

중단 방법: Netlify `AUTOMATION_RESTART_APPROVED=false` (또는 `AUTOMATION_ENABLED=false`) 변경 후 새 운영 배포. 배포가 완료되기 전 진행 중인 호출은 취소할 수 없으므로 물리 기기나 Tuya 앱을 통한 직접 정지가 별도로 필요할 수 있습니다.

Blobs 저장 검증: Function 로그에서 `monitoring_write_success`를 확인한 다음 관리자 대시보드 `storageEvidence.latestRunAt`이 최근 시각인지 확인합니다. 두 사실이 일치해야 저장/재조회 증거로 취급합니다.

### 저장 읽기 검증 및 대시보드 상태 (2026-11-17)

스케줄 함수가 PAUSED 상태에서 기존 `monitor/latest`를 **읽고** `monitoring_readback_verified`(마지막 기록 시각과 경과 초)을 로그에 남깁니다. 이어 `monitoring_write_success`를 출력합니다. 읽기 실패 시 `monitoring_readback_failed`를 남기며 기기 API 호출을 하지 않습니다.

관리자 대시보드는 Blobs 최근 기록의 읽기 상태(정상/기록 지연/기록 없음/읽기 실패), 기록 시각, 자동화 제어 모드, 안전 재개 차단 이유를 표시합니다. 읽기가 정상이라는 사실만으로 Tuya Trial 한도나 실제 물리 장치 동작이 검증된 것은 아닙니다.

실제 자동화 재개는 **보류**됩니다. 현재 Blobs 기반 호출 카운터는 동시성을 보장하지 않으며 정확한 API 호출 상한, LG 상태 매핑, 실물 후드 동작 및 즉시 중단 기능이 아직 검증되지 않았습니다.


## 수동 실기기 테스트 모드 (2026-11-17)

Postgres/Supabase 데이터베이스 **사용하지 않음**. 환경 변수 `LIVE_TEST_ENABLED=true`, `MANUAL_AUTOMATION_ENABLED=true`, `TUYA_COMMANDS_ENABLED=true`, `TUYA_QUOTA_GUARD_ENABLED=true` 설정 후 새 운영 배포에서 관리자 토큰으로 /api/tuya-status (GET), /api/tuya-control (POST) 호출 가능. `TUYA_DAILY_API_LIMIT=8` (허용 범위 1~8)이며 Blobs에 기록되는 카운터는 **동시 호출/다중 인스턴스에서 원자적이지 않음**. 엄격한 한도는 보장되지 않으므로 테스트 요청은 순차적으로 수동으로만 실행해야 합니다. 자동 스케줄 및 엔진은 본 테스트 단계에서 **항상 PAUSED**. 브라우저에서 인증 없는 제어 허용 없음.

실기기 테스트 전 Tuya Trial 잔여량을 공식 콘솔에서 확인하고, 플러그 ON/OFF가 물리적으로 후드를 동작시키는지 현장에서 확인하세요. 토큰 요청, 조회, 명령 등은 각각 Tuya API 예산을 사용합니다. 명령 수락은 물리적 팬 작동 확인이 아닙니다.

## 2026-11-17: LG 관찰 단계 및 변경 시 호출 설계

자동 제어는 여전히 **코드에서 완전히 잠김**(`deploymentAllowsRun() === false`).
`LG_OBSERVE_ONLY=true`로 재배포하면 매분 LG ThinQ 인덕션 상태만 조회하고 `monitor/lg-observed`에 `ON/OFF/UNKNOWN` 및 시각을 저장합니다. 어떤 Tuya API도 호출하지 않고 자동 후드 전원을 바꾸지 않습니다. 이 설정은 현재 자동으로 추가하지 않았습니다.

LG 상태 파서는 알려진 상태 및 버너 전력 신호가 없으면 **UNKNOWN**을 반환하도록 수정했습니다. 알 수 없는 값을 OFF로 간주하면 후드가 잘못 꺼질 수 있으므로 실제 ON/OFF 응답을 확인하기 전에는 자동 제어를 열지 않습니다.

추후 자동화 설계:
- 매분 LG 조회 → UNKNOWN/오프라인이면 후드 변경 없음
- 최초 실행은 기준 상태 저장 및 최초 1회 Tuya 상태 조회 (할당량 소모)
- OFF→ON은 후드 목표 ON; ON→OFF는 90초 OFF 감지 지속 시에만 후드 목표 OFF
- 목표와 직전 확인된 상태가 같으면 Tuya **API 조회·명령을 생략**
- 명령 후에는 수락 응답만으로 성공을 단정하지 않으며 지연 후 Tuya 상태 검증 1회
- 장애 시 재시도 간격 및 실패 누적 차단
- Blobs 비원자적 read-modify-write를 사용하므로 **함수 중복 실행 시 완벽한 단 한 번의 명령/엄격한 API 상한은 보장할 수 없음**. Trial 잔여 한도와 물리 후드 ON/OFF 실증 전 자동화 활성화 금지.

## Live automatic control (2026-11-17)
At the operator's explicit request the hard-coded `return false` in `deploymentAllowsRun` was replaced with a production-only deployment gate. With existing `AUTOMATION_ENABLED=true`, `TUYA_COMMANDS_ENABLED=true`, `TUYA_QUOTA_GUARD_ENABLED=true` and `TUYA_DAILY_API_LIMIT=1..8` (default 8), the published production Scheduled Function evaluates LG each minute. Pausing requires setting `AUTOMATION_ENABLED=false` and redeploying. Preview deployments remain blocked.
**Risk:** Netlify Blobs eventual-consistency quota reservations are not a strict global cap; the current Tuya Trial account remaining quota is not independently verified. This is a live physical appliance control. Review all commands and logs; stop from the Tuya app or device if needed. Observing a Tuya POST success does not verify hood fan motion.

## 2026-11-17: ON transition and Tuya request budget
- Removed the fixed 8-call local ceiling. Default local daily budget is 100 attempts; configurable via TUYA_DAILY_API_LIMIT (1–1000). This is not a provider-granted API quota or a strict concurrency-safe cap; Netlify Blobs may lose increments under concurrent requests.
- A newly required ON state after an OFF cooldown first verifies Tuya plug status. If plug is OFF, the prior OFF cooldown is cleared and ON is sent; if already ON, no command; if status cannot be verified, command remains blocked.
- Same-target retries, failure circuit breaker and 90-second OFF delay are retained. Device operation must be physically verified.
