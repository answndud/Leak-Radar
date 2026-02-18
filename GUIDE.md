# GUIDE

이 문서는 처음 쓰는 분도 바로 실행할 수 있도록 만든 "게임 가이드" 스타일 안내서입니다.

## 0. 한 줄 요약
한 번에 전부 켜려면: `pnpm -w run dev:all`

## 1. 준비물 체크 (아이템 장착)
- Node.js 20 이상
- pnpm 설치
- Docker (Postgres/Redis용)

설치 확인:
```bash
node -v
pnpm -v
```

## 2. 인프라 켜기 (DB/Redis)
로컬 개발은 Docker가 가장 간단합니다.
```bash
docker compose -p leak-radar -f infra/docker-compose.yml up -d
```

스키마 적용 (최초 1회 또는 인덱스 변경 시):
```bash
psql -h localhost -p 5432 -U leak -d leakdb -f infra/schema.sql
```
비밀번호는 `leak` 입니다.

## 3. 첫 실행 (게임 시작)
처음 한 번만 하면 됩니다.
```bash
pnpm install
```

## 4. 전부 한 번에 켜기 (원버튼 시작)
아래 한 줄만 실행하세요.
```bash
pnpm -w run dev:all
```

실행되면 이런 것들이 동시에 켜집니다:
- `api`: 검색/조회용 서버
- `web`: 화면(브라우저)
- `worker`: 자동 스캔 엔진

## 4-1. 스캔이 동작하려면 (필수 설정)
스캔은 GitHub 토큰이 있어야 실제로 동작합니다.

1) `.env`에 토큰 입력
```bash
GITHUB_TOKEN=여기에_토큰
```

운영 권장(관리자 API 보호):
```bash
ADMIN_API_KEY=강한_랜덤_값
VITE_ADMIN_API_KEY=강한_랜덤_값
VITE_ADMIN_ACTOR_ID=security-ops
API_CORS_ORIGINS=http://localhost:5173
ADMIN_AUDIT_RETENTION_DAYS=180

# 역할 기반으로 분리하고 싶으면 아래 형식 사용
ADMIN_API_KEYS=ops-key:ops|read;writer-key:read|write;danger-key:danger
```

2) 워커 재시작
```bash
pnpm -w run dev:worker
```

## 5. 기본 동작
- 워커는 자동 폴링으로 상시 스캔합니다.
- 페이지에 들어오면 DB에 쌓인 leak이 즉시 표시됩니다.
- 수동 스캔은 UI에서 provider를 다중 선택해 실행합니다.

## 6. 종료하기 (게임 종료)
터미널에서 `Ctrl + C` 를 누르면 전부 종료됩니다.

## 7. 실행 예시 (이렇게 보이면 성공)
```bash
$ pnpm -w run dev:all
api    | Server listening on http://0.0.0.0:4000
web    |  VITE v5.x  ready in 300 ms
web    |  Local:   http://localhost:5173/
worker | === Leak Radar 워커 시작 ===
```

## 8. 자주 쓰는 커맨드 (치트키 모음)
- API만 켜기: `pnpm -w run dev:api`
- Web만 켜기: `pnpm -w run dev:web`
- Worker만 켜기: `pnpm -w run dev:worker`
- 감사로그 정리: `pnpm -w --filter @leak/api run audit:prune`
- 감사로그 정리(스크립트): `ADMIN_AUDIT_RETENTION_DAYS=180 ./infra/scripts/run-audit-prune.sh`

## 9. 문제 해결 (막혔을 때)
### 포트가 이미 사용중일 때
이미 다른 프로세스가 쓰고 있는 경우입니다. 기존 실행을 종료하고 다시 시도하세요.

### 화면이 안 뜰 때
`dev:web`가 실행 중인지 확인하세요.

### 스캔 결과가 안 보일 때
- `dev:worker`와 `dev:api`가 둘 다 켜져 있어야 합니다.
- `GITHUB_TOKEN`이 설정되어 있는지 확인하세요.
- 초기에는 백필이 필요할 수 있어 2~5분 기다려 주세요.

## 10. 업데이트 규칙 (패치 노트)
새로운 실행 방법이 생기면 이 문서에 같이 적어 주세요.
