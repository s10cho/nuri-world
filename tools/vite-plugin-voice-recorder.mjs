// 개발 서버 전용 — 녹음 페이지(/voice-scripts.html)가 브라우저에서 녹음한 음성을
// 곧바로 public/assets/audio/ko/ 에 저장하고 manifest까지 갱신하도록 하는 API.
// 프로덕션 빌드(apply:'serve')에는 절대 포함되지 않는다.
//
//   GET  __voice/status          → { ok, ffmpeg, recorded: { [id]: {src,bytes,mtime} } }
//   POST __voice/save?id=&mime=  → 본문이 오디오 바이트. { ok, id, src, bytes, converted, warning? }
//   POST __voice/delete?id=      → { ok, id, fallback }

const MAX_BODY = 30 * 1024 * 1024; // 대사 하나 분량으로 충분. 실수로 큰 업로드를 받지 않도록 제한.

/** @type {Map<string, string> | null} id → 대사 원문 */
let lineIndex = null;

async function loadLineIndex() {
  if (lineIndex) return lineIndex;
  const { collectVoiceLines } = await import('./generate-voice-assets.mjs');
  lineIndex = new Map(collectVoiceLines().map(line => [line.id, line.text]));
  return lineIndex;
}

/** @param {import('node:http').IncomingMessage} req */
function readBody(req) {
  return new Promise((resolve, reject) => {
    /** @type {Buffer[]} */
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('업로드가 너무 큽니다(30MB 초과).'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** @param {import('node:http').ServerResponse} res */
function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(body);
}

/** @returns {import('vite').Plugin} */
export function voiceRecorderPlugin() {
  return {
    name: 'nuri-voice-recorder',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        // base('/nuri-world/')가 붙든 안 붙든 잡히도록 경로 끝으로 매칭한다
        const match = /\/__voice\/([a-z]+)$/.exec((req.url || '').split('?')[0]);
        if (!match) return next();

        const action = match[1];
        const url = new URL(req.url || '', 'http://localhost');
        const store = await import('./voice-recorder-store.mjs');

        try {
          if (action === 'status' && req.method === 'GET') {
            return sendJson(res, 200, { ok: true, ...(await store.recordingStatus()) });
          }

          if (action === 'save' && req.method === 'POST') {
            const id = url.searchParams.get('id') || '';
            const text = (await loadLineIndex()).get(id);
            if (!text) return sendJson(res, 400, { ok: false, error: `알 수 없는 대사 id: ${id}` });

            const bytes = await readBody(req);
            if (!bytes.length) return sendJson(res, 400, { ok: false, error: '빈 녹음입니다.' });

            const result = await store.saveRecording({
              id,
              text,
              bytes,
              mime: url.searchParams.get('mime') || req.headers['content-type'],
              convert: url.searchParams.get('convert') !== '0',
            });
            server.config.logger.info(
              `[voice] 저장 ${result.src} (${(result.bytes / 1024).toFixed(0)}KB${result.converted ? ', m4a 변환' : ''})`,
            );
            return sendJson(res, 200, { ok: true, id, ...result });
          }

          if (action === 'delete' && req.method === 'POST') {
            const id = url.searchParams.get('id') || '';
            const text = (await loadLineIndex()).get(id);
            if (!text) return sendJson(res, 400, { ok: false, error: `알 수 없는 대사 id: ${id}` });

            const result = await store.deleteRecording({ id, text });
            server.config.logger.info(`[voice] 삭제 ${id} (${result.removed.length}개 파일)`);
            return sendJson(res, 200, { ok: true, id, ...result });
          }

          return sendJson(res, 405, { ok: false, error: `지원하지 않는 요청: ${req.method} ${action}` });
        } catch (error) {
          server.config.logger.error(`[voice] 실패: ${error instanceof Error ? error.message : error}`);
          return sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      });
    },
  };
}

export default voiceRecorderPlugin;
