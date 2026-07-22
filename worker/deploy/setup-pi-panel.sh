#!/usr/bin/env bash
#
# Instala o PAINEL (Next) como servico no Raspberry Pi, ao lado do worker.
# Roda depois do setup-pi.sh. Faz o build, cria o .env.local (puxando o token
# do worker) e instala + habilita o servico systemd do painel.
#
# Uso (de dentro da pasta worker/):
#     bash deploy/setup-pi-panel.sh
#
# Porta do painel (padrao 3000): PANEL_PORT=3000 bash deploy/setup-pi-panel.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$WORKER_DIR/.." && pwd)"   # raiz do repo = app Next (painel)
SERVICE_NAME="robo-painel"
RUN_USER="${SUDO_USER:-$USER}"
NODE_BIN="$(command -v node || true)"
NPM_BIN="$(command -v npm || true)"
PORT="${PANEL_PORT:-3000}"

echo "==> Painel (raiz): $REPO_ROOT"
echo "==> Usuario: $RUN_USER  |  node: ${NODE_BIN:-?}  |  npm: ${NPM_BIN:-?}  |  porta: $PORT"

if [ -z "$NODE_BIN" ] || [ -z "$NPM_BIN" ]; then
  echo "ERRO: node/npm nao encontrados no PATH." >&2
  exit 1
fi

# 1. Build do painel (Next). Em Pi de 2 GB pode ser lento; 4 GB+ tranquilo.
echo "==> Instalando dependencias e buildando o painel..."
cd "$REPO_ROOT"
npm ci || npm install
npm run build

# 2. .env.local — puxa o token do worker (se existir) para conectar sem copiar.
if [ ! -f "$REPO_ROOT/.env.local" ]; then
  TOKEN=""
  if [ -f "$WORKER_DIR/.env" ]; then
    TOKEN="$(grep -E '^WORKER_API_TOKEN=' "$WORKER_DIR/.env" | cut -d= -f2- || true)"
  fi
  cat > "$REPO_ROOT/.env.local" <<ENV
# Painel no Pi: fala com o worker local.
WORKER_URL=http://localhost:8787
WORKER_API_TOKEN=$TOKEN
# Atendente local (mostra o card "Atendente Zapien" com status + abrir dashboard).
ATTENDANT_URL=http://localhost:3001
# IA para "Sugerir palavras" no plano (pode ser a mesma chave do Zapien):
ANTHROPIC_API_KEY=
# Preencha conforme os canais/fontes que for usar:
GOOGLE_PLACES_API_KEY=
IG_ACCESS_TOKEN=
IG_BUSINESS_ID=
SMTP_EMAIL=
SMTP_PASSWORD=
ENV
  echo "==> .env.local criado (edite as chaves de Google/Instagram/SMTP)."
else
  echo "==> .env.local ja existe; mantido."
fi

# 3. Servico systemd (sudo).
UNIT_PATH="/etc/systemd/system/${SERVICE_NAME}.service"
echo "==> Instalando servico em $UNIT_PATH (sudo)..."
sed -e "s#__USER__#${RUN_USER}#g" \
    -e "s#__REPO__#${REPO_ROOT}#g" \
    -e "s#__NPM__#${NPM_BIN}#g" \
    -e "s#__PORT__#${PORT}#g" \
    "$SCRIPT_DIR/robo-painel.service" | sudo tee "$UNIT_PATH" >/dev/null
sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE_NAME"
sudo systemctl restart "$SERVICE_NAME"

IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
cat <<MSG

===================================================================
 Painel no ar em:  http://${IP:-<ip-do-pi>}:$PORT

 Comandos:
   sudo systemctl status $SERVICE_NAME
   journalctl -u $SERVICE_NAME -f

 Para conectar o WhatsApp, abra o painel > card "Robo na nuvem" >
 "Acompanhar disparos": o codigo de pareamento aparece ali.
===================================================================
MSG
