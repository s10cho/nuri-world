// versionCode 를 하나 올린다. android/version-code.txt 가 단일 소스이고,
// android/app/build.gradle 이 이 파일을 읽어 간다.
//
// 규칙: versionCode 는 정수이고 되돌릴 수 없으며, 스토어에 올리는 파일마다
// 이전보다 커야 한다. 번호가 건너뛰어도(1 → 5) 문제되지 않는다.
//
// 사용: node tools/bump-version-code.mjs        # +1
//       node tools/bump-version-code.mjs --show # 현재 값만 출력

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'android', 'version-code.txt');

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
  console.log(current || 1);
} else {
  const next = current + 1;
  await writeFile(FILE, `${next}\n`);
  console.log(`versionCode ${current || '(없음)'} → ${next}`);
}
