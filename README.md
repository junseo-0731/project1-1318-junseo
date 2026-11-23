# SKY-GUARD — AI 자율 비행 드론 임무 수행 시스템

AI 주변 환경 인식, A* 자율 비행 경로 설계, 비행 성능 및 배터리 분석, 상황별 자율 비행 판단, 실시간 3D WebGL 비행 시뮬레이션, 다중 기준 임무 최적화를 통합한 자율 비행 드론 관제 및 공학 시뮬레이션 웹 애플리케이션입니다.

자세한 기획 및 기술 명세는 [`PRD.md`](./PRD.md)를 참고하세요.

## 주요 기능

- **Dashboard**: 기체 상태, 배터리 잔량(`%` / `Wh`), 비행 속도·고도, 이동 거리, 감지 장애물 수, 임무 진행률, 공역 경로 미리보기 및 배터리 감소 곡선 통합 관제
- **Environment Analysis**: 드론 항공 사진 업로드 및 샘플 이미지 3종 지원, Gemini AI(`gemini-4-hydrogen`) 기반 장애물 탐지(건물·나무·전선·사람·차량), 이미지 바운딩 박스 오버레이, 수동 편집 및 비행 지도 투영
- **Flight Planning & Performance**: `30×20` (`600m×400m`) 공역 격자 내 8방향 A* 우회 경로 탐색 및 드래그 편집, `Wh = V × Ah` · `비행 시간 = Wh ÷ W` · `이동 거리 = m/s × s` 기반 성능 게이지 및 Recharts 그래프 시각화
- **Autonomous Control**: 돌발 장애물 출현, 경로 차단, 저전력(18%) 자동 복귀(RTH), 강풍(14.5 m/s) 발생, 목적지 도착 시나리오에 대한 이전/신규 경로 비교 및 Gemini AI 판단 근거 해설
- **Flight Simulator (3D)**: Three.js WebGL 기반 3D 쿼드콥터 드론 시뮬레이션, 비행 중 3D 지형 클릭 장애물 배치/제거 시 실시간 A* 재탐색, 저전력 RTH 전환, 풍향 입자 및 카메라 프리셋(추적 뷰 / 전체 조감 / 1인칭 FPV)
- **Mission Optimization**: 안전성·비행 시간·배터리 효율·이동 거리 가중치 조절을 통한 4종 전략 경로 비교(표, 막대/레이더 차트) 및 Gemini AI 추천 해설

## 기술 스택

- **Frontend**: React 19, TypeScript, Tailwind CSS v4, Recharts, Three.js, Lucide React
- **Backend**: Node.js, Express, `tsx`, `@google/genai` (`gemini-4-hydrogen`)

## 로컬 실행 방법

1. **저장소 클론 및 패키지 설치**
   ```bash
   npm install
   ```

2. **환경 변수 설정**
   `.env.example`을 복사해 `.env` 파일을 생성하고 Gemini API 키를 입력합니다.
   ```bash
   cp .env.example .env
   ```
   ```env
   GEMINI_API_KEY="YOUR_GEMINI_API_KEY"
   ```

3. **개발 서버 실행**
   ```bash
   npm run dev
   ```
   브라우저에서 `http://localhost:3000`으로 접속합니다.

4. **프로덕션 빌드 및 실행**
   ```bash
   npm run build
   NODE_ENV=production npm start
   ```
