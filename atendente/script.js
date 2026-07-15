const fs = require('fs');
const file = 'public/settings.html';
let content = fs.readFileSync(file, 'utf8');

const waSearch = '<h3 class="font-semibold text-lg mb-2">WhatsApp Business API</h3>';
const waReplace = <div style="padding: 24px; border: 1px solid var(--gray-200); border-radius: var(--radius-lg); margin-bottom: 24px; background: white; box-shadow: var(--shadow-sm);">
            <div style="display: flex; align-items: center; gap: 16px; margin-bottom: 20px;">
              <div style="width: 48px; height: 48px; border-radius: 12px; background: #25D366; display: flex; align-items: center; justify-content: center; color: white;">
                <i data-lucide="message-circle" style="width: 24px; height: 24px;"></i>
              </div>
              <div>
                <h3 class="font-semibold text-xl" style="margin: 0; line-height: 1.2;">WhatsApp</h3>
                <p class="text-sm text-gray-500" style="margin: 0;">Conecte sua conta do WhatsApp Business ou Pessoal.</p>
              </div>
            </div>;

const mpSearch = /<h3 class="font-semibold text-lg mb-2 border-t border-gray-200 pt-6">\s*Mercado Pago\s*<span class="badge badge-gray text-xs" id="badge-mp">Não configurado<\/span>\s*<\/h3>\s*<p class="text-sm text-gray-500 mb-4">Permite que a IA gere links de pagamento automaticamente\.<\/p>/;
const mpReplace = </div>
          <div style="padding: 24px; border: 1px solid var(--gray-200); border-radius: var(--radius-lg); margin-bottom: 24px; background: white; box-shadow: var(--shadow-sm);">
            <div style="display: flex; align-items: center; gap: 16px; margin-bottom: 20px;">
              <div style="width: 48px; height: 48px; border-radius: 12px; background: #009EE3; display: flex; align-items: center; justify-content: center; color: white;">
                <i data-lucide="credit-card" style="width: 24px; height: 24px;"></i>
              </div>
              <div>
                <div style="display: flex; align-items: center; gap: 8px;">
                  <h3 class="font-semibold text-xl" style="margin: 0; line-height: 1.2;">Mercado Pago</h3>
                  <span class="badge badge-gray text-xs" id="badge-mp">Não configurado</span>
                </div>
                <p class="text-sm text-gray-500" style="margin: 0; margin-top: 4px;">Permite que a IA gere links de pagamento automaticamente.</p>
              </div>
            </div>;

const meSearch = /<h3 class="font-semibold text-lg mb-2 border-t border-gray-200 pt-6">\s*Melhor Envio\s*<span class="badge badge-warning text-xs ml-2">Elite<\/span>\s*<span class="badge badge-gray text-xs ml-1" id="badge-frete">Não configurado<\/span>\s*<\/h3>\s*<p class="text-sm text-gray-500 mb-4">A IA calculará o frete automaticamente usando o CEP do cliente\.<\/p>/;
const meReplace = </div>
          <div style="padding: 24px; border: 1px solid var(--gray-200); border-radius: var(--radius-lg); margin-bottom: 24px; background: white; box-shadow: var(--shadow-sm);">
            <div style="display: flex; align-items: center; gap: 16px; margin-bottom: 20px;">
              <div style="width: 48px; height: 48px; border-radius: 12px; background: #FBBF24; display: flex; align-items: center; justify-content: center; color: white;">
                <i data-lucide="truck" style="width: 24px; height: 24px;"></i>
              </div>
              <div>
                <div style="display: flex; align-items: center; gap: 8px;">
                  <h3 class="font-semibold text-xl" style="margin: 0; line-height: 1.2;">Melhor Envio</h3>
                  <span class="badge badge-warning text-xs">Elite</span>
                  <span class="badge badge-gray text-xs" id="badge-frete">Não configurado</span>
                </div>
                <p class="text-sm text-gray-500" style="margin: 0; margin-top: 4px;">A IA calculará o frete automaticamente usando o CEP do cliente.</p>
              </div>
            </div>;

const endSearch = /<div id="me-token-section" class="form-group">\s*<label class="form-label">Token do Melhor Envio \(deixe em branco para manter\)<\/label>\s*<input type="password" class="form-input" id="melhor_envio_token" placeholder="Cole o token aqui">\s*<\/div>\s*<\/div>\s*<\/div>/;
const endReplace = <div id="me-token-section" class="form-group">
            <label class="form-label">Token do Melhor Envio (deixe em branco para manter)</label>
            <input type="password" class="form-input" id="melhor_envio_token" placeholder="Cole o token aqui">
          </div>
          </div>
        </div>
      </div>;

content = content.replace(waSearch, waReplace);
content = content.replace(mpSearch, mpReplace);
content = content.replace(meSearch, meReplace);
content = content.replace(endSearch, endReplace);

fs.writeFileSync(file, content, 'utf8');
console.log('done');
