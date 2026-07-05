// 누리의 한글 왕국 — 도메인 타입 모델 (Phase 2 · A4)
//
// 전역 앰비언트 선언: @ts-check를 켠 .js 파일에서 import 없이 바로 참조한다
// (예: /** @type {Record<string, JamoInfo>} */).
// 런타임에는 로드되지 않는 타입 전용 파일이다. DOM 전역 `Screen`과 충돌을
// 피하려 화면 타입은 `AppScreen`으로 명명한다.

// ---- 커리큘럼 데이터 -------------------------------------------------------

/** 예시 단어: 글자 + 이모지 */
interface Word {
  /** 단어 (예: '가방') */
  w: string;
  /** 이모지 (예: '🎒') */
  e: string;
}

/** 자모 사전 항목 */
interface JamoInfo {
  /** 글자 이름 — TTS로 읽어 줌 (예: '기역') */
  name: string;
  /** 예시 단어들 */
  words: Word[];
}

/** 음절 목표 (탑 게임): 목표 음절 + 뜻을 강화하는 연결 단어 */
interface TowerTarget {
  /** 목표 음절 (예: '가') */
  s: string;
  /** 연결 단어 (예: '가방') */
  w: string;
  /** 이모지 */
  e: string;
}

// ---- 왕국 / 스테이지 -------------------------------------------------------

/** 왕국 유형 — 스테이지 형태와 진행 활동을 결정 */
type KingdomType = 'jamo' | 'tower' | 'village' | 'boss';

/** 왕국 id */
type KingdomId = 'meadow' | 'lake' | 'tower' | 'village' | 'castle';

/** 자모 학습 스테이지 (초원·호수) */
interface JamoStage {
  title: string;
  /** 이 스테이지에서 새로 배우는 자모 */
  jamo: string[];
  /** 복습용 자모 (마지막 정리 스테이지에만) */
  review?: string[];
}

/** 글자 조합 스테이지 (탑) */
interface TowerStage {
  title: string;
  targets: TowerTarget[];
}

/** 단어 완성 스테이지 (마을) */
interface VillageStage {
  title: string;
  words: Word[];
}

/** 보스 스테이지 (성) */
interface BossStage {
  title: string;
}

/** 스테이지 — 왕국 유형별 형태의 합 */
type Stage = JamoStage | TowerStage | VillageStage | BossStage;

/** 왕국 공통 필드 */
interface KingdomBase {
  id: KingdomId;
  /** 진행 순서 (1부터) */
  order: number;
  name: string;
  subtitle: string;
  /** 배경 이미지 경로 */
  bg: string;
  goal: string;
  /** 왕국 진입 시 내레이션 */
  intro: string;
}

interface JamoKingdom extends KingdomBase {
  type: 'jamo';
  stages: JamoStage[];
}
interface TowerKingdom extends KingdomBase {
  type: 'tower';
  stages: TowerStage[];
}
interface VillageKingdom extends KingdomBase {
  type: 'village';
  stages: VillageStage[];
}
interface BossKingdom extends KingdomBase {
  type: 'boss';
  stages: BossStage[];
}

/** 왕국 — `type`으로 판별하는 유니온 (스테이지 형태가 type에 대응) */
type Kingdom = JamoKingdom | TowerKingdom | VillageKingdom | BossKingdom;

// ---- 화면 구성 데이터 -------------------------------------------------------

/** 월드맵 핫스팟 좌표 (배경 이미지 기준 %) */
interface MapSpot {
  x: number;
  y: number;
}

/** 스토리 인트로 한 장면 */
interface StoryPanel {
  /** 배경 이미지 경로 */
  bg: string;
  text: string;
  /** 등장 캐릭터 연출 (없으면 배경만) */
  char?: 'eraser' | 'both';
}

/** 엔딩 축제 */
interface Festival {
  bg: string;
  lines: string[];
}

/** 캐릭터 이미지 경로 모음 */
interface Characters {
  nuri: string;
  pori: string;
  eraser: string;
}

// ---- 화면 · 게임 수명주기 계약 ---------------------------------------------

/** 게임/활동 결과 — stage 루프가 별점 계산에 사용 */
interface GameResult {
  /** 이 활동에서의 실수 횟수 */
  mistakes: number;
}

/** 게임/활동에 전달되는 컨텍스트 */
interface GameContext {
  /** 활동을 렌더할 컨테이너 */
  area: HTMLElement;
  /** 현재 왕국 (게임에서는 대개 미사용) */
  kingdom?: KingdomId;
  /** 현재 스테이지 (게임에서는 대개 미사용) */
  stage?: Stage;
  /** 화면 수명 신호 — 이탈 시 abort된다 */
  signal: AbortSignal;
}

/**
 * 화면 요소 — 라우터 go()가 렌더 함수 결과에 수명주기 훅을 붙인다.
 * (DOM 전역 `Screen`과 충돌을 피하려 AppScreen으로 명명)
 */
interface AppScreen extends HTMLElement {
  /** 화면 수명 컨트롤러 — go()가 생성, 화면 이탈 시 abort */
  _ac?: AbortController;
  /** 화면 표시 시작 루틴 — 수명 signal을 받아 타이머·TTS를 관리 */
  _onShow?: (signal: AbortSignal) => void | Promise<void>;
  /** 첫 사용자 제스처(오디오 잠금 해제) 시 환영 음성 재생 (title 화면 전용) */
  _welcomeOnUnlock?: () => void;
}

/** 화면 렌더 함수 — params를 받아 화면 요소를 만든다 */
type ScreenRender = (params?: any) => AppScreen;
