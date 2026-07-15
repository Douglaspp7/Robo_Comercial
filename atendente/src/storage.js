/**
 * Interface simples de armazenamento de arquivos da plataforma.
 *
 * Hoje os arquivos são BLOBs no SQLite (mesmas tabelas de sempre — nenhuma
 * mudança de schema). Esta camada existe para que uma futura migração para
 * R2/S3 troque só a implementação, sem mexer nas rotas.
 *
 * Uso atual: mídia de conversa (message_media). Catálogo, documentos extras e
 * logo têm queries próprias em db.js e migram para cá quando fizer sentido.
 */
import { randomBytes } from 'node:crypto';
import { mediaQueries } from './db.js';

export const storage = {
  /**
   * Persiste um arquivo de mídia e devolve o id público (128 bits aleatórios,
   * não enumerável — é ele que vai na URL assinada servida ao WhatsApp).
   */
  save({ tenantId, mime, filename = null, content }) {
    const id = randomBytes(16).toString('hex');
    mediaQueries.insert.run(id, tenantId, mime || 'application/octet-stream', filename, content);
    return id;
  },

  /** Lê um arquivo pelo id. Retorna a linha (tenant_id, mime, filename, content) ou undefined. */
  read(id) {
    return mediaQueries.get.get(id);
  },

  /** Remove um arquivo pelo id. Retorna true se algo foi removido. */
  delete(id) {
    return mediaQueries.deleteById.run(id).changes > 0;
  },
};
