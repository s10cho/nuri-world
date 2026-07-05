// 배포 시 자산 URL에 버전 쿼리(?v=<커밋해시>)를 붙여 브라우저·CDN 캐시를 무효화한다.
// 무빌드 정적 앱이라 번들 해시가 없으므로, index.html 엔트리 포인트와 JS 모듈의
// 상대 import 전부에 동일 버전 쿼리를 스탬프한다. CI 배포 job의 체크아웃 사본에만
// 적용하므로 커밋된 소스는 그대로 유지된다.
//
// 사용: node tools/stamp-version.mjs <version>
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const version = (process.argv[2] || Date.now().toString(36)).trim();

let stamped = 0;

// 1) index.html — css/*.css, js/*.js 엔트리 포인트
{
  const html = readFileSync('index.html', 'utf8');
  const next = html.replace(/(href|src)="((?:css|js)\/[^"?]+\.(?:css|js))"/g, (_m, attr, path) => {
    stamped++;
    return `${attr}="${path}?v=${version}"`;
  });
  writeFileSync('index.html', next);
}

// 2) js/** — 모듈 간 상대 import (정적 import ... from './x.js', 동적 import('./x.js'))
/** @param {string} dir */
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.js')) stampModule(p);
  }
}

/** @param {string} file */
function stampModule(file) {
  const src = readFileSync(file, 'utf8');
  const next = src.replace(/(from\s+|import\()(['"])(\.[^'"]+\.js)\2/g, (_m, kw, q, spec) => {
    stamped++;
    return `${kw}${q}${spec}?v=${version}${q}`;
  });
  if (next !== src) writeFileSync(file, next);
}

walk('js');

console.log(`stamped version ?v=${version} across ${stamped} references`);
