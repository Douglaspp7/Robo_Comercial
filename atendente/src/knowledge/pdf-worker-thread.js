import { parentPort, workerData } from 'node:worker_threads';
import { extractPdfTextDirect } from './text.js';

try {
  const result = await extractPdfTextDirect(Buffer.from(workerData.buffer), {
    maxPages: workerData.maxPages,
  });
  parentPort.postMessage({ ok: true, result });
} catch (err) {
  parentPort.postMessage({
    ok: false,
    error: {
      message: err.message,
      code: err.code || 'pdf_processing_error',
    },
  });
}
