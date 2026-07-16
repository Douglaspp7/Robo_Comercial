#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$WORKER_DIR/.env"
CONTROL_URL="https://zapien.app"

echo "======================================================"
echo " Instalacao do executor Robo Comercial no Raspberry Pi"
echo " Render = painel/cerebro | Pi = numeros/execucao"
echo "======================================================"

if ! command -v curl >/dev/null || ! command -v git >/dev/null; then
  echo "==> Instalando ferramentas basicas..."
  sudo apt-get update
  sudo apt-get install -y curl git build-essential python3
fi

if ! command -v node >/dev/null || [ "$(node -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null || echo 0)" -lt 20 ]; then
  echo "==> Instalando Node.js 22..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

read -r -p "Numeros WhatsApp, com DDI, separados por virgula (ex. 551199...,551198...): " WA_NUMBERS_INPUT
WA_NUMBERS_INPUT="$(printf '%s' "$WA_NUMBERS_INPUT" | tr -cd '0-9,')"
if [ -z "$WA_NUMBERS_INPUT" ]; then echo "ERRO: informe ao menos um numero." >&2; exit 1; fi
read -r -s -p "Token do Render (ROBO_CONTROL_TOKEN): " CONTROL_TOKEN_INPUT
echo
if [ -z "$CONTROL_TOKEN_INPUT" ]; then echo "ERRO: token obrigatorio." >&2; exit 1; fi
read -r -p "Nome deste Pi [pi-casa]: " WORKER_ID_INPUT
WORKER_ID_INPUT="${WORKER_ID_INPUT:-pi-casa}"

echo "==> Validando comunicacao com o Render..."
HTTP_CODE="$(curl --max-time 20 -sS -o /tmp/robo-control-check -w '%{http_code}' -H "x-robo-control-token: $CONTROL_TOKEN_INPUT" "$CONTROL_URL/api/robo/control/status" || true)"
if [ "$HTTP_CODE" != "200" ]; then
  echo "ERRO: Render respondeu HTTP ${HTTP_CODE:-sem resposta}. Confira o token e se o servico esta Live." >&2
  exit 1
fi

cd "$WORKER_DIR"
[ -f "$ENV_FILE" ] && cp "$ENV_FILE" "$ENV_FILE.backup.$(date +%Y%m%d%H%M%S)"
cp "$WORKER_DIR/.env.example" "$ENV_FILE"

set_env() {
  local key="$1" value="$2" escaped
  escaped="$(printf '%s' "$value" | sed 's/[&|]/\\&/g')"
  sed -i "s|^${key}=.*|${key}=${escaped}|" "$ENV_FILE"
}
set_env CONTROL_PLANE_URL "$CONTROL_URL"
set_env CONTROL_PLANE_TOKEN "$CONTROL_TOKEN_INPUT"
set_env WORKER_ID "$WORKER_ID_INPUT"
set_env WORKER_DRY_RUN "true"
set_env WA_NUMBERS "$WA_NUMBERS_INPUT"
set_env WA_SEND_WINDOW "9-19"
set_env WA_MAX_PER_HOUR "8"

echo "==> Instalando dependencias e servico..."
bash "$SCRIPT_DIR/setup-pi.sh"

echo
echo "======================================================"
echo " Instalacao concluida em MODO TESTE (nenhum disparo)."
echo
echo " Proximo passo — parear os numeros:"
echo "   cd $WORKER_DIR"
echo "   npm run pair"
echo
echo " Depois inicie e acompanhe:"
echo "   sudo systemctl start robo-worker"
echo "   journalctl -u robo-worker -f"
echo
echo " Procure no log: Controle central ... dryRun=true"
echo " Nao altere WORKER_DRY_RUN=false antes do teste controlado."
echo "======================================================"
