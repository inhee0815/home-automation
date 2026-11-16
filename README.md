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
