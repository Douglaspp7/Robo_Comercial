/**
 * Upload centralizado — substitui o multer.memoryStorage().
 *
 * Antes, cada arquivo chegava INTEIRO na memória do processo (até 50MB por
 * upload); alguns uploads simultâneos bastavam para inflar a RAM. Agora:
 *
 *  - o multer grava num diretório temporário em disco (UPLOAD_TMP_DIR, padrão
 *    os.tmpdir()/zapien-uploads) com nome IMPREVISÍVEL (randomUUID) — o nome
 *    original do arquivo nunca vira caminho;
 *  - uploadGuard limita uploads simultâneos (UPLOAD_MAX_CONCURRENT, padrão 3)
 *    e garante a limpeza do temporário no fim da resposta — sucesso, erro de
 *    validação/parsing/banco ou conexão abortada;
 *  - o tipo REAL é validado por magic bytes (requireMagicBytes), não só pela
 *    extensão/Content-Type do navegador;
 *  - readUploadBuffer() lê o arquivo para Buffer só DEPOIS das validações,
 *    para os parsers que exigem Buffer (PDF, imagem, transcrição);
 *  - uma varredura periódica remove temporários órfãos mais antigos que
 *    UPLOAD_TMP_MAX_AGE_MIN (padrão 60 min) — sobras de crash/restart.
 *
 * Os arquivos continuam persistidos como BLOB no SQLite (sem mudança de
 * schema nesta etapa) — ver src/storage.js para a interface de armazenamento.
 */
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import {
  mkdirSync, readFileSync, unlinkSync, readdirSync, statSync,
  openSync, readSync, closeSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const uploadTmpDir = process.env.UPLOAD_TMP_DIR || join(tmpdir(), 'zapien-uploads');

const MAX_CONCURRENT = Math.max(1, Number(process.env.UPLOAD_MAX_CONCURRENT) || 3);
const TMP_MAX_AGE_MS = Math.max(1, Number(process.env.UPLOAD_TMP_MAX_AGE_MIN) || 60) * 60 * 1000;

// Teto absoluto do multer: folga acima do limite individual de PDF (5MB em
// todos os planos); o limite real por plano continua sendo checado por
// endpoint via getPlanLimits() — ver enforcePlanFileSize() em api.js.
const HARD_MAX_BYTES = 50 * 1024 * 1024;

let activeUploads = 0;

/** Visível para testes/observabilidade. */
export function getActiveUploads() {
  return activeUploads;
}

/**
 * Middleware que roda ANTES do multer nas rotas de upload:
 *  - recusa com 503 + Retry-After quando há uploads simultâneos demais
 *    (protege a memória e o disco sem derrubar o processo);
 *  - registra hooks de limpeza: ao terminar a resposta (finish) ou cair a
 *    conexão (close), o arquivo temporário é removido SEMPRE.
 */
export function uploadGuard(req, res, next) {
  if (activeUploads >= MAX_CONCURRENT) {
    res.setHeader('Retry-After', '10');
    return res.status(503).json({
      error: 'Muitos envios de arquivo ao mesmo tempo. Aguarde alguns segundos e tente novamente.',
    });
  }
  activeUploads++;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    activeUploads--;
    const path = req.file?.path;
    if (path && path.startsWith(uploadTmpDir)) {
      try { unlinkSync(path); } catch { /* já removido */ }
    }
  };
  res.on('finish', release);
  res.on('close', release);
  next();
}

// Nome temporário imprevisível — NUNCA derivado do nome original enviado
// (evita path traversal e colisão). A extensão/tipo é validada à parte.
const diskStorage = multer.diskStorage({
  destination(_req, _file, cb) {
    try {
      mkdirSync(uploadTmpDir, { recursive: true });
      cb(null, uploadTmpDir);
    } catch (err) {
      cb(err);
    }
  },
  filename(_req, _file, cb) {
    cb(null, `up-${randomUUID()}.tmp`);
  },
});

export const upload = multer({
  storage: diskStorage,
  limits: { fileSize: HARD_MAX_BYTES, files: 1 },
});

// --- Validação de tipo real (magic bytes) ---
// Cobre os formatos permitidos pelo produto (alinhados com plans.js e
// voice-intake.js). Para tipos sem assinatura conhecida, não bloqueia
// (known:false) — o allowlist de MIME de cada rota continua valendo.

function startsWithBytes(buf, bytes, offset = 0) {
  if (buf.length < offset + bytes.length) return false;
  return bytes.every((b, i) => buf[offset + i] === b);
}
function ascii(buf, start, end) {
  return buf.slice(start, end).toString('latin1');
}

const MAGIC_CHECKS = {
  'image/png': (b) => startsWithBytes(b, [0x89, 0x50, 0x4e, 0x47]),
  'image/jpeg': (b) => startsWithBytes(b, [0xff, 0xd8, 0xff]),
  'image/jpg': (b) => startsWithBytes(b, [0xff, 0xd8, 0xff]),
  'image/webp': (b) => ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP',
  'image/gif': (b) => ascii(b, 0, 4) === 'GIF8',
  'application/pdf': (b) => ascii(b, 0, 5) === '%PDF-',
  'audio/mpeg': (b) => ascii(b, 0, 3) === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0),
  'audio/mp3': (b) => MAGIC_CHECKS['audio/mpeg'](b),
  'audio/wav': (b) => ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WAVE',
  'audio/x-wav': (b) => MAGIC_CHECKS['audio/wav'](b),
  'audio/webm': (b) => startsWithBytes(b, [0x1a, 0x45, 0xdf, 0xa3]),
  'video/webm': (b) => startsWithBytes(b, [0x1a, 0x45, 0xdf, 0xa3]),
  'audio/ogg': (b) => ascii(b, 0, 4) === 'OggS',
  // Container ISO-BMFF (mp4/m4a/mov): "ftyp" no offset 4.
  'audio/mp4': (b) => ascii(b, 4, 8) === 'ftyp',
  'audio/m4a': (b) => ascii(b, 4, 8) === 'ftyp',
  'audio/x-m4a': (b) => ascii(b, 4, 8) === 'ftyp',
  'video/mp4': (b) => ascii(b, 4, 8) === 'ftyp',
  'video/quicktime': (b) => ascii(b, 4, 8) === 'ftyp',
};

/**
 * Confere os primeiros bytes do arquivo contra a assinatura do MIME declarado.
 * Lê no máximo 16 bytes do disco — não carrega o arquivo na memória.
 * @returns {{known: boolean, ok: boolean}}
 */
export function verifyMagicBytes(path, declaredMime) {
  const check = MAGIC_CHECKS[String(declaredMime || '').toLowerCase()];
  if (!check) return { known: false, ok: true };
  const head = Buffer.alloc(16);
  let fd;
  try {
    fd = openSync(path, 'r');
    const read = readSync(fd, head, 0, 16, 0);
    return { known: true, ok: read >= 4 && check(head.slice(0, read)) };
  } catch {
    return { known: true, ok: false };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/**
 * Middleware (depois do multer): rejeita com 415 quando o conteúdo real do
 * arquivo não corresponde ao Content-Type declarado pelo navegador.
 */
export function requireMagicBytes(req, res, next) {
  if (!req.file?.path) return next();
  const { known, ok } = verifyMagicBytes(req.file.path, req.file.mimetype);
  if (known && !ok) {
    return res.status(415).json({
      error: 'O conteúdo do arquivo não corresponde ao tipo informado. Envie o arquivo original.',
    });
  }
  next();
}

/**
 * Lê o upload para um Buffer — chamar só DEPOIS das validações (tipo, plano,
 * armazenamento), para parsers que exigem Buffer (PDF/imagem/transcrição).
 * Compatível com file.buffer (testes/legado). Não guarde referências extras:
 * use e descarte, para o GC liberar a memória logo após o parse.
 */
export function readUploadBuffer(file) {
  if (!file) return null;
  if (file.buffer) return file.buffer;
  return readFileSync(file.path);
}

/**
 * Varredura de temporários órfãos (crash/restart no meio de um upload):
 * remove up-*.tmp mais antigos que UPLOAD_TMP_MAX_AGE_MIN.
 * @returns {number} quantos arquivos foram removidos
 */
export function sweepUploadTmp(maxAgeMs = TMP_MAX_AGE_MS) {
  let removed = 0;
  let entries;
  try {
    entries = readdirSync(uploadTmpDir);
  } catch {
    return 0; // diretório ainda não existe
  }
  const cutoff = Date.now() - maxAgeMs;
  for (const entry of entries) {
    if (!entry.startsWith('up-') || !entry.endsWith('.tmp')) continue;
    const path = join(uploadTmpDir, entry);
    try {
      if (statSync(path).mtimeMs < cutoff) {
        unlinkSync(path);
        removed++;
      }
    } catch { /* removido em paralelo */ }
  }
  if (removed > 0) console.log(`[upload] varredura removeu ${removed} temporário(s) órfão(s)`);
  return removed;
}

/** Inicia a varredura periódica (boot + a cada 15 min). unref() não segura o processo. */
export function startUploadTmpSweep() {
  sweepUploadTmp();
  setInterval(() => sweepUploadTmp(), 15 * 60 * 1000).unref();
}
