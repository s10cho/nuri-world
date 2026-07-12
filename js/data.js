// 누리의 한글 왕국 — 커리큘럼 데이터
// 자음 19개(기본 14 + 쌍자음 5) + 모음 21개(기본 10 + 복합 11) = 총 40자모

// ---- 자모 사전 -----------------------------------------------------------
// name: 글자 이름(TTS로 읽어줌), words: 예시 단어(이모지 포함)
/** @type {Record<string, JamoInfo>} */
export const JAMO = {
  // 기본 자음 14
  'ㄱ': { name: '기역',   words: [{ w: '가방', e: '🎒' }, { w: '고래', e: '🐳' }] },
  'ㄴ': { name: '니은',   words: [{ w: '나비', e: '🦋' }, { w: '나무', e: '🌳' }] },
  'ㄷ': { name: '디귿',   words: [{ w: '다리', e: '🌉' }, { w: '도넛', e: '🍩' }] },
  'ㄹ': { name: '리을',   words: [{ w: '로봇', e: '🤖' }, { w: '라면', e: '🍜' }] },
  'ㅁ': { name: '미음',   words: [{ w: '모자', e: '🎩' }, { w: '무지개', e: '🌈' }] },
  'ㅂ': { name: '비읍',   words: [{ w: '바나나', e: '🍌' }, { w: '비행기', e: '✈️' }] },
  'ㅅ': { name: '시옷',   words: [{ w: '사자', e: '🦁' }, { w: '수박', e: '🍉' }] },
  'ㅇ': { name: '이응',   words: [{ w: '오리', e: '🦆' }, { w: '우유', e: '🥛' }] },
  'ㅈ': { name: '지읒',   words: [{ w: '자동차', e: '🚗' }, { w: '주스', e: '🧃' }] },
  'ㅊ': { name: '치읓',   words: [{ w: '치즈', e: '🧀' }, { w: '초콜릿', e: '🍫' }] },
  'ㅋ': { name: '키읔',   words: [{ w: '코끼리', e: '🐘' }, { w: '코', e: '👃' }] },
  'ㅌ': { name: '티읕',   words: [{ w: '토끼', e: '🐰' }, { w: '토마토', e: '🍅' }] },
  'ㅍ': { name: '피읖',   words: [{ w: '포도', e: '🍇' }, { w: '피자', e: '🍕' }] },
  'ㅎ': { name: '히읗',   words: [{ w: '하마', e: '🦛' }, { w: '해', e: '☀️' }] },
  // 쌍자음 5
  'ㄲ': { name: '쌍기역', words: [{ w: '꽃', e: '🌸' }, { w: '꿀', e: '🍯' }] },
  'ㄸ': { name: '쌍디귿', words: [{ w: '딸기', e: '🍓' }, { w: '땅콩', e: '🥜' }] },
  'ㅃ': { name: '쌍비읍', words: [{ w: '빵', e: '🍞' }, { w: '뽀뽀', e: '😘' }] },
  'ㅆ': { name: '쌍시옷', words: [{ w: '씨앗', e: '🌱' }, { w: '쌀', e: '🍚' }] },
  'ㅉ': { name: '쌍지읒', words: [{ w: '짜장면', e: '🍜' }, { w: '찌개', e: '🍲' }] },
  // 기본 모음 10
  'ㅏ': { name: '아', words: [{ w: '아기', e: '👶' }, { w: '아이스크림', e: '🍦' }] },
  'ㅑ': { name: '야', words: [{ w: '야구', e: '⚾' }, { w: '야옹 고양이', e: '🐱' }] },
  'ㅓ': { name: '어', words: [{ w: '어항', e: '🐠' }, { w: '엄마', e: '👩' }] },
  'ㅕ': { name: '여', words: [{ w: '여우', e: '🦊' }, { w: '여름', e: '⛱️' }] },
  'ㅗ': { name: '오', words: [{ w: '오리', e: '🦆' }, { w: '오이', e: '🥒' }] },
  'ㅛ': { name: '요', words: [{ w: '요요', e: '🪀' }, { w: '요리', e: '🍳' }] },
  'ㅜ': { name: '우', words: [{ w: '우산', e: '☂️' }, { w: '우유', e: '🥛' }] },
  'ㅠ': { name: '유', words: [{ w: '유니콘', e: '🦄' }, { w: '유령', e: '👻' }] },
  'ㅡ': { name: '으', words: [{ w: '으쓱으쓱', e: '💪' }, { w: '음악', e: '🎵' }] },
  'ㅣ': { name: '이', words: [{ w: '이불', e: '🛏️' }, { w: '이빨', e: '🦷' }] },
  // 복합 모음 11
  'ㅐ': { name: '애', words: [{ w: '애벌레', e: '🐛' }, { w: '새', e: '🐦' }] },
  'ㅒ': { name: '얘', words: [{ w: '얘기', e: '💬' }, { w: '얘들아', e: '🧒' }] },
  'ㅔ': { name: '에', words: [{ w: '게', e: '🦀' }, { w: '레몬', e: '🍋' }] },
  'ㅖ': { name: '예', words: [{ w: '시계', e: '⏰' }, { w: '예쁜 꽃', e: '💐' }] },
  'ㅘ': { name: '와', words: [{ w: '와플', e: '🧇' }, { w: '과자', e: '🍪' }] },
  'ㅙ': { name: '왜', words: [{ w: '돼지', e: '🐷' }, { w: '왜?', e: '🤔' }] },
  'ㅚ': { name: '외', words: [{ w: '참외', e: '🍈' }, { w: '외투', e: '🧥' }] },
  'ㅝ': { name: '워', words: [{ w: '원숭이', e: '🐵' }, { w: '샤워', e: '🚿' }] },
  'ㅞ': { name: '웨', words: [{ w: '스웨터', e: '🧥' }, { w: '웨하스', e: '🍪' }] },
  'ㅟ': { name: '위', words: [{ w: '귀', e: '👂' }, { w: '위', e: '⬆️' }] },
  'ㅢ': { name: '의', words: [{ w: '의사', e: '🧑‍⚕️' }, { w: '의자', e: '🪑' }] },
};

/** @type {string[]} */
export const ALL_CONSONANTS = ['ㄱ','ㄴ','ㄷ','ㄹ','ㅁ','ㅂ','ㅅ','ㅇ','ㅈ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ','ㄲ','ㄸ','ㅃ','ㅆ','ㅉ'];
/** @type {string[]} */
export const ALL_VOWELS = ['ㅏ','ㅑ','ㅓ','ㅕ','ㅗ','ㅛ','ㅜ','ㅠ','ㅡ','ㅣ','ㅐ','ㅒ','ㅔ','ㅖ','ㅘ','ㅙ','ㅚ','ㅝ','ㅞ','ㅟ','ㅢ'];

// ---- 글자 조각의 탑: 음절 목표 ------------------------------------------
// 각 항목: 목표 음절, 연결 단어(뜻 강화)
/** @type {TowerStage[]} */
export const TOWER_STAGES = [
  { title: 'ㅏ와 친구들 1', targets: [
    { s: '가', w: '가방', e: '🎒' }, { s: '나', w: '나비', e: '🦋' },
    { s: '다', w: '다리', e: '🌉' }, { s: '라', w: '라면', e: '🍜' }, { s: '마', w: '마늘', e: '🧄' },
  ]},
  { title: 'ㅏ와 친구들 2', targets: [
    { s: '바', w: '바나나', e: '🍌' }, { s: '사', w: '사자', e: '🦁' },
    { s: '자', w: '자동차', e: '🚗' }, { s: '차', w: '차', e: '🚙' }, { s: '카', w: '카드', e: '🃏' },
  ]},
  { title: 'ㅗ와 친구들', targets: [
    { s: '고', w: '고래', e: '🐳' }, { s: '노', w: '노래', e: '🎤' },
    { s: '도', w: '도넛', e: '🍩' }, { s: '로', w: '로봇', e: '🤖' }, { s: '모', w: '모자', e: '🎩' },
  ]},
  { title: 'ㅜ와 ㅣ 친구들', targets: [
    { s: '구', w: '구름', e: '☁️' }, { s: '두', w: '두부', e: '🥘' },
    { s: '무', w: '무지개', e: '🌈' }, { s: '기', w: '기차', e: '🚂' }, { s: '지', w: '지구', e: '🌍' },
  ]},
  { title: '도전! 섞어 만들기', targets: [
    { s: '오', w: '오리', e: '🦆' }, { s: '우', w: '우산', e: '☂️' },
    { s: '소', w: '소', e: '🐮' }, { s: '코', w: '코', e: '👃' }, { s: '하', w: '하마', e: '🦛' },
  ]},
];

// ---- 이름 없는 마을: 받침 없는 단어 + 구출할 주민 -------------------------
/** @type {VillageStage[]} */
export const VILLAGE_STAGES = [
  { title: '동물 친구들', words: [
    { w: '나비', e: '🦋' }, { w: '오리', e: '🦆' }, { w: '하마', e: '🦛' }, { w: '사자', e: '🦁' },
  ]},
  { title: '숲속 친구들', words: [
    { w: '나무', e: '🌳' }, { w: '바다', e: '🌊' }, { w: '무지개', e: '🌈' }, { w: '다리', e: '🌉' },
  ]},
  { title: '맛있는 친구들', words: [
    { w: '포도', e: '🍇' }, { w: '바나나', e: '🍌' }, { w: '치즈', e: '🧀' }, { w: '피자', e: '🍕' },
  ]},
  { title: '우리 집 친구들', words: [
    { w: '모자', e: '🎩' }, { w: '의자', e: '🪑' }, { w: '소파', e: '🛋️' }, { w: '비누', e: '🧼' },
  ]},
  { title: '동물원 친구들', words: [
    { w: '코끼리', e: '🐘' }, { w: '여우', e: '🦊' }, { w: '토끼', e: '🐰' }, { w: '너구리', e: '🦝' },
  ]},
];

// ---- 왕국 구성 ------------------------------------------------------------
/** @type {Record<KingdomId, Kingdom>} */
export const KINGDOMS = {
  meadow: {
    id: 'meadow', order: 1, type: 'jamo',
    name: '기억의 초원', subtitle: '자음 왕국',
    bg: 'assets/images/backgrounds/memory_meadow.jpg',
    goal: '자음을 되찾아 초원을 다시 푸르게 만들어요!',
    intro: '여기는 기억의 초원이에요. 지우개 몬스터가 자음을 다 지워 버렸어요! 소리를 잘 듣고 자음을 찾아 주세요!',
    // 훈민정음 제자원리 순서: 상형 기본자(ㄱㄴㅁㅅㅇ) → 가획자 → 병서(쌍자음).
    // ㄹ은 엄밀히는 가획자가 아닌 이체자(異體字)지만, ㄴ→ㄷ→ㅌ 계열과 함께
    // 학습 편의상 같은 단계에 배치했다.
    stages: [
      { title: '처음 만난 자음', jamo: ['ㄱ', 'ㄴ', 'ㅁ', 'ㅅ', 'ㅇ'] },
      { title: '소리가 자란 자음 1', jamo: ['ㅋ', 'ㄷ', 'ㅌ', 'ㄹ'] },
      { title: '소리가 자란 자음 2', jamo: ['ㅂ', 'ㅍ', 'ㅈ', 'ㅊ'] },
      { title: '자음 모두 모여!', jamo: ['ㅎ'], review: ['ㄱ','ㄴ','ㅁ','ㅅ','ㅇ','ㅋ','ㄷ','ㅌ','ㄹ','ㅂ','ㅍ','ㅈ','ㅊ','ㅎ'] },
      { title: '쌍둥이 자음', jamo: ['ㄲ', 'ㄸ', 'ㅃ', 'ㅆ', 'ㅉ'] },
    ],
  },
  lake: {
    id: 'lake', order: 2, type: 'jamo',
    name: '울림의 호수', subtitle: '모음 왕국',
    bg: 'assets/images/backgrounds/echo_lake.jpg',
    goal: '모음의 소리를 되찾아 호수를 맑게 만들어요!',
    intro: '울림의 호수에 온 걸 환영해요! 모음이 사라져서 호수의 노래가 멈췄어요. 모음 소리를 되찾아 주세요!',
    // 제자원리 순서: 기본자(ㅡㅣ) → 초출자(ㅏㅓㅗㅜ) → 재출자(ㅑㅕㅛㅠ) → 합용
    stages: [
      { title: '기본 모음 친구들', jamo: ['ㅡ', 'ㅣ', 'ㅏ', 'ㅓ'] },
      { title: '위아래 모음 친구들', jamo: ['ㅗ', 'ㅜ', 'ㅑ', 'ㅕ'] },
      { title: '모음 모두 모여!', jamo: ['ㅛ', 'ㅠ'], review: ['ㅡ','ㅣ','ㅏ','ㅓ','ㅗ','ㅜ','ㅑ','ㅕ','ㅛ','ㅠ'] },
      { title: '만나서 새 소리 1', jamo: ['ㅐ', 'ㅔ', 'ㅒ', 'ㅖ', 'ㅘ'] },
      { title: '만나서 새 소리 2', jamo: ['ㅙ', 'ㅚ', 'ㅝ', 'ㅞ', 'ㅟ', 'ㅢ'] },
    ],
  },
  tower: {
    id: 'tower', order: 3, type: 'tower',
    name: '글자 조각의 탑', subtitle: '글자 조합 왕국',
    bg: 'assets/images/backgrounds/letter_tower.jpg',
    goal: '자음과 모음을 붙여서 글자를 만들어요!',
    intro: '글자 조각의 탑이에요! 자음과 모음이 만나면 글자가 태어나요. 조각을 맞춰서 글자를 만들어 보세요!',
    stages: TOWER_STAGES,
  },
  village: {
    id: 'village', order: 4, type: 'village',
    name: '이름 없는 마을', subtitle: '받침 없는 단어 왕국',
    bg: 'assets/images/backgrounds/nameless_village.jpg',
    goal: '글자를 찾아 주민들의 이름을 되찾아 주세요!',
    intro: '주민들의 이름이 사라졌어요! 글자를 찾아 이름을 완성하면 주민들이 다시 웃을 수 있어요!',
    stages: VILLAGE_STAGES,
  },
  castle: {
    id: 'castle', order: 5, type: 'boss',
    name: '지우개 몬스터의 성', subtitle: '최종 결전의 장소',
    bg: 'assets/images/backgrounds/monster_castle.jpg',
    goal: '배운 글자로 지우개 몬스터를 물리쳐요!',
    intro: '드디어 지우개 몬스터의 성이에요! 그동안 배운 글자의 힘으로 몬스터를 물리치고 왕국을 구해요!',
    stages: [{ title: '최종 결전!' }],
  },
};

/** @type {KingdomId[]} */
export const KINGDOM_ORDER = ['meadow', 'lake', 'tower', 'village', 'castle'];

// 월드맵 핫스팟 좌표 (배경 이미지 기준 %)
/** @type {Record<string, MapSpot>} */
export const MAP_SPOTS = {
  meadow:   { x: 17, y: 34 },
  lake:     { x: 24, y: 63 },
  tower:    { x: 50, y: 50 },
  village:  { x: 72, y: 47 },
  castle:   { x: 77, y: 17 },
  festival: { x: 71, y: 78 },
};

// ---- 스토리 인트로 --------------------------------------------------------
/** @type {StoryPanel[]} */
export const STORY_INTRO = [
  {
    bg: 'assets/images/backgrounds/title_screen.jpg',
    text: '옛날 옛적, 글자들이 반짝반짝 빛나는\n누리 한글 왕국이 있었어요.',
  },
  {
    bg: 'assets/images/backgrounds/story_intro_dark_kingdom.jpg',
    text: '어느 날, 지우개 몬스터가 나타나\n왕국의 글자들을 지워 버렸어요!',
    char: 'eraser',
  },
  {
    bg: 'assets/images/backgrounds/nameless_village.jpg',
    text: '주민들은 이름을 잃어버리고,\n왕국은 엉망이 되어 버렸어요.',
  },
  {
    bg: 'assets/images/backgrounds/world_map.jpg',
    text: '누리와 마법 토끼 포리는 글자를 되찾는\n모험을 떠나기로 했어요!',
    char: 'both',
  },
];

// 왕국 축제(엔딩)
/** @type {Festival} */
export const FESTIVAL = {
  bg: 'assets/images/backgrounds/festival_ending.jpg',
  lines: [
    '와! 글자들이 모두 돌아왔어요!',
    '누리 덕분에 한글 왕국이 다시 반짝반짝 빛나요.',
    '주민들이 축제를 열어 누리를 축하해요! 🎉',
  ],
};

// 캐릭터 이미지 경로
/** @type {Characters} */
export const CHARACTERS = {
  nuri:   'assets/images/characters/nuri/nuri_web.png',
  pori:   'assets/images/characters/pori/pori_web.png',
  eraser: 'assets/images/characters/eraser/eraser_web.png',
};

// 스테이지 클리어 축하 일러스트 — 누리·포리가 함께 기뻐하는 장면(결과 화면에서 랜덤 노출)
/** @type {string[]} */
export const CELEBRATIONS = [
  'assets/images/celebrations/nuri-pori-celebrate-jump.png',
  'assets/images/celebrations/nuri-pori-celebrate-listen.png',
  'assets/images/celebrations/nuri-pori-celebrate-puzzle.png',
];

// 보스전 배틀 일러스트 — 누리·포리가 마법 지팡이로 몬스터를 공격
export const BATTLE_HERO = 'assets/images/celebrations/nuri-pori-magic.png';
