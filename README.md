# Chisa Bot(Discord Music Bot)

AI 기능을 탑재하여 편의성을 극대화 시킨 디스코드 노래 재생 봇 입니다.<br>
단순 노래 재생부터, 전용 플레이리스트와 대시보드, 노래 추천, 자동 재생 등 다양한 기능을 지원합니다.<br>
봇 소개 및 초대 링크: https://chisabot.duckdns.org

---

## 🌟 주요 기능 (Features)

### 1. 고성능 음악 플레이어 (Lavalink & Shoukaku)
* **Lavalink v4 기반**: 끊김 없고 안정적인 고음질 오디오 스트리밍을 제공합니다.
* **다양한 재생 모드**: 재생/일시정지, 다음 곡/이전 곡 재생, 대기열(Queue) 관리, 반복 재생(Loop), 셔플(Shuffle) 등의 제어 기능을 지원합니다.
* **자동 재생 (Autoplay)**: 대기열이 비었을 때 지정된 무드(Mood)나 인기 추천 곡 리스트를 자동으로 선택하여 재생을 이어갑니다.

### 2. AI 대화 및 스마트 컨트롤 (Gemini AI Integration)
* **치사 페르소나**: "명조 워더링 웨이브" 치사의 실제 대사 및 상세 설정을 바탕으로, 친근하고 차분한 말투로 응답합니다.
* **스마트 도구 실행 (Function Calling)**: 사용자의 모호한 요청(예: "잔잔한 음악 틀어줘", "요즘 인기 있는 노래 검색해줘")을 이해하고, 적절한 기능(음악 추천, 대기열 확인, 플레이리스트 관리 등)을 알아서 수행합니다.
* **멀티 모델 지원 및 Failover**: `gemini-3.1-flash-lite`, `gemini-2.5-flash` 등 여러 Google Gemini 모델을 우선순위에 따라 순차 구동하여 안정적인 API 응답을 보장합니다.

### 3. 웹 제어 대시보드 (Web Dashboard)
* **실시간 대시보드 UI**: 현재 재생 중인 곡의 앨범 아트, 아티스트, 진행률(Seek Position), 신청자 프로필을 직관적으로 확인하고 제어합니다.
* **대기열 및 플레이리스트 조작**: 웹 상에서 드래그 앤 드롭으로 간편하게 곡 재생 순서를 변경하고, 원클릭으로 대기열 혹은 개인 플레이리스트에서 곡을 삭제할 수 있습니다.

### 4. 데이터베이스 및 통계 (Oracle DB & Sequelize)
* **Oracle Autonomous Database**: 안정적인 엔터프라이즈급 클라우드 데이터베이스를 연동합니다.
* **재생 히스토리 및 통계**: 오늘 재생된 곡 수, 서버의 실시간 인기 음악 순위(Trending) 차트를 수집 및 제공합니다.
* **개인 플레이리스트**: 각 유저별로 자주 듣는 곡 목록을 DB에 보관하고 디스코드 또는 대시보드에서 언제든 불러와 재생할 수 있습니다.

---

## 🛠️ 기술 스택 (Technology Stack)

* **언어 및 런타임**: Node.js (TypeScript, ES Modules)
* **봇 프레임워크**: `discord.js v14`
* **음악 엔진**: `shoukaku v4` (Lavalink v4 Wrapper)
* **웹 서버 & 실시간 통신**: `Express v5`, `Socket.io v4`
* **인공지능**: `@google/genai` (Gemini API), `GPT-SoVITS` (Python/Docker)
* **데이터베이스**: `Sequelize ORM` (Oracle DB Dialect)
* **도구 및 배포**: `Docker`, `Docker Compose`, `Jenkins`, `FFmpeg`

---

## 🚀 로컬 구동 방법 (Quick Start)

### 1. 환경 변수 설정
프로젝트 루트 폴더에 `.env` 파일을 작성합니다.
```env
DISCORD_TOKEN=your_discord_bot_token
CLIENT_ID=your_discord_client_id
GUILD_ID=your_discord_guild_id
GEMINI_API_KEY=your_gemini_api_key
TTS_SERVER_URL=http://localhost:9880
LAVALINK_HOST=localhost
LAVALINK_PORT=2333
LAVALINK_PASSWORD=your_lavalink_password
LAVALINK_SECURE=false
ALLOW_SOUNDCLOUD_FALLBACK=true
DB_USER=your_db_username
DB_PASSWORD=your_db_password
DB_NAME=your_db_name
DB_CONNECT_STRING=your_oracle_db_connection_string
SPECIAL_USER_ID=your_discord_user_id
YOUTUBE_API_KEY=your_youtube_api_key
```

### 2. 패키지 설치
```bash
npm install
```

### 3. 로컬에서 실행 (개발 모드)
```bash
# 디스코드 슬래시 명령어 등록
npm run deploy

# 실시간 변경 감지 실행 (tsx watch)
npm run dev
```

### 4. 도커 컴포즈로 전체 시스템 구동
Lavalink, TTS Engine, 봇 서버 등을 포함한 멀티 컨테이너 환경을 한 번에 실행합니다.
```bash
docker compose up -d --build
```
