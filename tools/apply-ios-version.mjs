// iOS 프로젝트의 버전 두 개를 저장소의 단일 소스에서 채워 넣는다.
//
//   package.json 의 version → MARKETING_VERSION      (사용자에게 보이는 "1.1.0")
//   ios/build-number.txt    → CURRENT_PROJECT_VERSION (업로드마다 커져야 하는 정수)
//
// 안드로이드는 build.gradle 이 두 파일을 직접 읽지만, Xcode 는 빌드 설정 안에 값을
// 박아 두는 구조라 빌드 전에 이 스크립트로 project.pbxproj 에 써 넣는다.
// (Debug·Release 두 구성 모두에 같은 값이 들어간다.)
//
// 사용: node tools/apply-ios-version.mjs          # 반영
//       node tools/apply-ios-version.mjs --check  # 반영 없이 현재/목표 값만 출력

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PBXPROJ = path.join(ROOT, 'ios', 'App', 'App.xcodeproj', 'project.pbxproj');
const BUILD_FILE = path.join(ROOT, 'ios', 'build-number.txt');

const version = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8')).version;
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  throw new Error(`package.json 의 version 이 x.y.z 형식이 아닙니다: ${version}`);
}

const build = Number.parseInt((await readFile(BUILD_FILE, 'utf8')).trim(), 10);
if (!Number.isInteger(build) || build < 1) {
  throw new Error(`${BUILD_FILE} 가 1 이상의 정수가 아닙니다`);
}

const before = await readFile(PBXPROJ, 'utf8');
const after = before
  .replaceAll(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${version};`)
  .replaceAll(/CURRENT_PROJECT_VERSION = [^;]+;/g, `CURRENT_PROJECT_VERSION = ${build};`);

// 두 구성(Debug·Release)에 각각 하나씩, 총 2개가 아니면 프로젝트 구조가 바뀐 것이라 멈춘다.
for (const [key, count] of [
  ['MARKETING_VERSION', (after.match(/MARKETING_VERSION = /g) || []).length],
  ['CURRENT_PROJECT_VERSION', (after.match(/CURRENT_PROJECT_VERSION = /g) || []).length],
]) {
  if (count !== 2) throw new Error(`${key} 가 2개여야 하는데 ${count}개입니다 — 프로젝트 확인 필요`);
}

if (process.argv.includes('--check')) {
  console.log(`목표: ${version} (${build})`);
  console.log(after === before ? '이미 반영됨' : '반영 필요');
} else if (after === before) {
  console.log(`iOS 버전 이미 ${version} (${build})`);
} else {
  await writeFile(PBXPROJ, after);
  console.log(`iOS 버전 → ${version} (${build})`);
}
