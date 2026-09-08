// iOS 시뮬레이터 스모크 테스트 — Apple 개발자 계정 없이 돌릴 수 있는 유일한 iOS 검증이다.
//
// 빌드 → 설치 → 실행하고 웹뷰 콘솔을 지켜본다. 네이티브 브리지가 얽힌 문제는 웹에서도
// 안드로이드에서도 안 잡히는데(플러그인 프록시를 Promise 로 넘겨 "TextToSpeech.then()"
// UNIMPLEMENTED 가 나던 버그가 실제로 이렇게만 보였다), 여기서는 콘솔에 그대로 찍힌다.
//
// 사용: npm run build:ios:sim
//   결과 스크린샷: store/build/ios-sim.png

import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP_ID = 'com.sycho.nuri.hangulkingdom';
const OUT_DIR = path.join(ROOT, 'store', 'build');
const SHOT = path.join(OUT_DIR, 'ios-sim.png');
const DERIVED = path.join(ROOT, 'ios', 'App', 'build', 'sim-dd');

// xcode-select 가 CommandLineTools 를 가리켜도 Xcode 로 빌드할 수 있게 직접 지정한다.
const env = { ...process.env };
if (!env.DEVELOPER_DIR && existsSync('/Applications/Xcode.app')) {
  env.DEVELOPER_DIR = '/Applications/Xcode.app/Contents/Developer';
}

const sh = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { encoding: 'utf8', env, maxBuffer: 64 * 1024 * 1024, ...opts });

/** 부팅돼 있는 시뮬레이터가 있으면 그것을, 없으면 아이폰 하나를 고른다. */
function pickDevice() {
  const list = JSON.parse(sh('xcrun', ['simctl', 'list', 'devices', 'available', '--json'])).devices;
  const all = Object.values(list).flat();
  const booted = all.find(d => d.state === 'Booted');
  if (booted) return booted;
  const iphone = all.filter(d => d.name.startsWith('iPhone')).pop();
  if (!iphone) throw new Error('사용 가능한 iPhone 시뮬레이터가 없습니다');
  return iphone;
}

const device = pickDevice();
console.log(`시뮬레이터: ${device.name}`);

console.log('빌드 중 …');
sh('xcodebuild', [
  '-project', path.join(ROOT, 'ios', 'App', 'App.xcodeproj'),
  '-scheme', 'App', '-configuration', 'Debug',
  '-destination', `platform=iOS Simulator,id=${device.udid}`,
  '-derivedDataPath', DERIVED,
  'CODE_SIGNING_ALLOWED=NO', 'build',
], { stdio: ['ignore', 'ignore', 'inherit'] });

if (device.state !== 'Booted') sh('xcrun', ['simctl', 'boot', device.udid]);
sh('xcrun', ['simctl', 'bootstatus', device.udid, '-b']);

const appPath = path.join(DERIVED, 'Build', 'Products', 'Debug-iphonesimulator', 'App.app');
sh('xcrun', ['simctl', 'install', device.udid, appPath]);
// 안 떠 있으면 simctl 이 시끄럽게 실패하므로 출력을 버린다.
try { sh('xcrun', ['simctl', 'terminate', device.udid, APP_ID], { stdio: 'ignore' }); } catch { /* 안 떠 있으면 그만 */ }

console.log('실행 중 — 콘솔 15초 관찰 …');
let log = '';
const proc = spawn('xcrun', ['simctl', 'launch', '--console-pty', device.udid, APP_ID], { env });
proc.stdout.on('data', d => { log += d; });
proc.stderr.on('data', d => { log += d; });

await new Promise(r => setTimeout(r, 15_000));
proc.kill();

mkdirSync(OUT_DIR, { recursive: true });
sh('xcrun', ['simctl', 'io', device.udid, 'screenshot', SHOT]);
writeFileSync(path.join(OUT_DIR, 'ios-sim.log'), log);

console.log('--- 웹뷰 콘솔 ---');
console.log(log.split('\n').filter(l => l.includes('⚡️')).join('\n') || '(없음)');
console.log(`\n스크린샷: ${SHOT}`);

// 부팅 중 터진 JS 오류는 앱을 에러 화면으로 떨어뜨린다 — 실패로 다룬다.
const bad = log.split('\n').filter(l => /\[error\]|unhandledrejection|부팅 실패|UNIMPLEMENTED/.test(l));
if (bad.length) {
  console.error('\n✗ 웹뷰에서 오류가 났습니다:');
  bad.forEach(l => console.error('  ' + l.trim()));
  process.exit(1);
}
if (!log.includes('WebView loaded')) {
  console.error('\n✗ 웹뷰가 로드되지 않았습니다');
  process.exit(1);
}
console.log('\n✓ 오류 없이 부팅했습니다');
