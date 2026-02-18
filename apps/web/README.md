# Web App

Explore/Leaderboard UI를 제공하는 프론트엔드 앱입니다.

## 주요 기능
- leak feed 무한 스크롤
- provider/기간/정렬 필터
- 수동 스캔 provider 다중 선택
- 피드 아카이브(마크다운 내보내기)
- 피드 초기화/중복 제거 버튼
- 관리자 감사로그 패널(필터/검색/정렬)
- 감사로그 cursor 기반 더보기 + 자동 로드
- 감사로그 CSV 내보내기, metadata 상세/복사
- 감사로그 필터/정렬 상태 URL 동기화(새로고침 시 유지)
- 감사로그 프리셋 버튼 + 현재 필터 링크 복사
- 감사로그 커스텀 프리셋 저장/삭제(로컬 저장)
- 감사로그 커스텀 프리셋 export/import(JSON)
- 감사로그 공유 프리셋 저장/삭제(API, ops 권한)
- 감사로그 공유 프리셋 이름 변경(API, ops 권한)
- 공유 프리셋 수정/삭제 버튼은 소유자 또는 override 권한에서만 활성화
- 공유 프리셋 메타데이터(category/description/pin) 입력 지원

## 실행
- 개발 서버: `pnpm -w run dev:web`
- 전체 실행: `pnpm -w run dev:all`

## 의존
- API 서버(`http://localhost:4000`) 필요
