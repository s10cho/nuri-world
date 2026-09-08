// 스토어에 올리는 빌드 번호를 하나 올린다. 플랫폼마다 카운터 파일 한 곳이 단일 소스다.
//
//   android/version-code.txt  → android/app/build.gradle 이 읽어 versionCode 로 쓴다.
//   ios/build-number.txt      → tools/apply-ios-version.mjs 가 읽어 CURRENT_PROJECT_VERSION 에 쓴다.
//
// 규칙: 정수이고 되돌릴 수 없으며, 스토어에 올리는 파일마다 이전보다 커야 한다.
// 번호가 건너뛰어도(1 → 5) 문제되지 않는다. 두 스토어는 서로 다른 카운터를 쓰므로
// 안드로이드만 올려도 iOS 번호는 그대로다.
//
// 사용: node tools/bump-version-code.mjs              # 안드로이드 +1
//       node tools/bump-version-code.mjs --ios        # iOS +1
//       node tools/bump-version-code.mjs --ios --show # 현재 값만 출력

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const IOS = process.argv.includes('--ios');
const FILE = IOS
  ? path.join(ROOT, 'ios', 'build-number.txt')
  : path.join(ROOT, 'android', 'version-code.txt');

/** @returns {Promise<number>} */
async function read() {
  try {
    const n = Number.parseInt((await readFile(FILE, 'utf8')).trim(), 10);
    if (Number.isInteger(n) && n > 0) return n;
    throw new Error('정수가 아님');
  } catch (err) {
    if (/** @type {any} */ (err)?.code === 'ENOENT') return 0; // 파일이 없으면 1부터 시작
    throw new Error(`${FILE} 를 읽을 수 없습니다`, { cause: err });
  }
}

const current = await read();

if (process.argv.includes('--show')) {
  // console.log(숫자)는 ANSI 색상 코드를 붙인다 — 이 값을 파일명·CLI 인자로 쓰면 깨진다.
  console.log(String(current || 1));
} else {
  const next = current + 1;
  await writeFile(FILE, `${next}\n`);
  console.log(`${IOS ? 'iOS build' : 'versionCode'} ${current || '(없음)'} → ${next}`);
}
