#!/usr/bin/env bash
#
# Instala o ATENDENTE (a copia do Zapien que vende Zapien) como servico no
# Raspberry Pi, ao lado do worker e do painel. Roda em MODO GATEWAY: nao fala
# com a Meta, recebe as respostas do worker e responde pelo mesmo chip.
#
# Roda DEPOIS do setup-pi.sh (worker). Faz npm ci, gera os segredos proprios,
# puxa os tokens do worker, cria o .env, (opcional) roda o seed do tenant e
# instala + habilita o servico systemd.
#
# Uso (de dentro da pasta worker/):
#     bash deploy/setup-pi-atendente.sh
#
# Automacao maxima (preenche a chave e ja roda o seed):
#     ANTHROPIC_API_KEY=sk-ant-... ADMIN_EMAIL=voce@exemplo.com \
#       bash deploy/setup-pi-atendente.sh
#
# Porta (padrao 3001):  ATTENDANT_PORT=3001 bash deploy/setup-pi-atendente.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$WORKER_DIR/.." && pwd)"
ATTENDANT_DIR="$REPO_ROOT/atendente"
SERVICE_NAME="robo-atendente"
RUN_USER="${SUDO_USER:-$USER}"
NODE_BIN="$(command -v node || true)"
NPM_BIN="$(command -v npm || true)"
PORT="${ATTENDANT_PORT:-3001}"

echo "==> Atendente: $ATTENDANT_DIR"
echo "==> Usuario: $RUN_USER  |  node: ${NODE_BIN:-?}  |  npm: ${NPM_BIN:-?}  |  porta: $PORT"

if [ -z "$NODE_BIN" ] || [ -z "$NPM_BIN" ]; then
  echo "ERRO: node/npm nao encontrados no PATH." >&2
  exit 1
fi
if [ ! -d "$ATTENDANT_DIR" ]; then
  echo "ERRO: pasta atendente/ nao encontrada em $ATTENDANT_DIR." >&2
  exit 1
fi
if ! command -v openssl >/dev/null 2>&1; then
  echo "ERRO: openssl nao encontrado (necessario para gerar os segredos)." >&2
  exit 1
fi

# 1. Dependencias (compila better-sqlite3; precisa de build-essential).
echo "==> Instalando dependencias do atendente..."
cd "$ATTENDANT_DIR"
npm ci || npm install

# 2. .env — gera segredos proprios e puxa os tokens do worker.
DB_PATH="$ATTENDANT_DIR/data/atendente.db"
mkdir -p "$ATTENDANT_DIR/data"

if [ ! -f "$ATTENDANT_DIR/.env" ]; then
  WTOKEN=""
  ATOKEN=""
  if [ -f "$WORKER_DIR/.env" ]; then
    WTOKEN="$(grep -E '^WORKER_API_TOKEN=' "$WORKER_DIR/.env" | cut -d= -f2- || true)"
    ATOKEN="$(grep -E '^ATTENDANT_TOKEN=' "$WORKER_DIR/.env" | cut -d= -f2- || true)"
  fi
  # Se o worker ainda nao tinha ATTENDANT_TOKEN, gera um e grava nos dois lados.
  if [ -z "$ATOKEN" ]; then
    ATOKEN="$(openssl rand -hex 24)"
    if [ -f "$WORKER_DIR/.env" ] && ! grep -qE '^ATTENDANT_TOKEN=' "$WORKER_DIR/.env"; then
      printf '\n# Encaminhamento para o atendente (gerado pelo setup do atendente).\nATTENDANT_URL=http://localhost:%s\nATTENDANT_TOKEN=%s\n' "$PORT" "$ATOKEN" >> "$WORKER_DIR/.env"
      echo "==> ATTENDANT_URL/ATTENDANT_TOKEN adicionados ao .env do worker."
    fi
  fi

  ENC_KEY="$(openssl rand -hex 32)"       # PROPRIO deste numero (nao e o do Zapien)
  SESS_SECRET="$(openssl rand -base64 32)"

  cat > "$ATTENDANT_DIR/.env" <<ENV
# Atendente (Zapien que vende Zapien) — modo gateway. NAO comitar.
GATEWAY_MODE=1
PORT=$PORT
NODE_ENV=production

# A IA (pode ser a MESMA chave do Zapien):
ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY:-}
ANTHROPIC_MODEL=claude-haiku-4-5
ADMIN_EMAIL=${ADMIN_EMAIL:-}

# Proprios deste numero (gerados agora — NAO sao os de producao):
DATABASE_PATH=$DB_PATH
DATA_ENCRYPTION_KEY=$ENC_KEY
SESSION_SECRET=$SESS_SECRET
APP_URL=http://localhost:$PORT

# Ligacao com o worker (tokens iguais dos dois lados):
WORKER_URL=http://localhost:8787
WORKER_API_TOKEN=$WTOKEN
ATTENDANT_TOKEN=$ATOKEN

# Tenant fixo que vende Zapien (preenchido pelo seed, abaixo):
ATTENDANT_TENANT_ID=
ENV
  chmod 600 "$ATTENDANT_DIR/.env"
  echo "==> .env criado (segredos gerados; tokens do worker puxados)."
else
  echo "==> .env ja existe; mantido."
fi

# 3. Seed do tenant — so roda se a chave Anthropic estiver preenchida.
HAS_KEY="$(grep -E '^ANTHROPIC_API_KEY=.+' "$ATTENDANT_DIR/.env" || true)"
HAS_TENANT="$(grep -E '^ATTENDANT_TENANT_ID=.+' "$ATTENDANT_DIR/.env" || true)"
if [ -n "$HAS_KEY" ] && [ -z "$HAS_TENANT" ]; then
  echo "==> Rodando o seed do tenant \"Zapien vende Zapien\"..."
  SEED_OUT="$(ATTENDANT_SEED_EMAIL="${ATTENDANT_SEED_EMAIL:-vende@zapien.app}" \
             ATTENDANT_SEED_PASSWORD="${ATTENDANT_SEED_PASSWORD:-zapien-vende-zapien}" \
             node --env-file="$ATTENDANT_DIR/.env" scripts/seed-zapien-tenant.mjs)"
  echo "$SEED_OUT"
  TID="$(echo "$SEED_OUT" | grep -oE 'TENANT_ID=[a-f0-9-]+' | head -1 | cut -d= -f2 || true)"
  if [ -n "$TID" ]; then
    sed -i "s#^ATTENDANT_TENANT_ID=.*#ATTENDANT_TENANT_ID=$TID#" "$ATTENDANT_DIR/.env"
    echo "==> ATTENDANT_TENANT_ID gravado no .env: $TID"
  fi
elif [ -z "$HAS_KEY" ]; then
  echo "==> ATENCAO: ANTHROPIC_API_KEY em branco no .env — o seed NAO rodou."
  echo "    Preencha a chave em $ATTENDANT_DIR/.env e rode:"
  echo "    (cd $ATTENDANT_DIR && node --env-file=.env scripts/seed-zapien-tenant.mjs)"
  echo "    Depois cole o TENANT_ID em ATTENDANT_TENANT_ID e reinicie o servico."
fi

# 4. Servico systemd (sudo).
UNIT_PATH="/etc/systemd/system/${SERVICE_NAME}.service"
echo "==> Instalando servico em $UNIT_PATH (sudo)..."
sed -e "s#__USER__#${RUN_USER}#g" \
    -e "s#__ATTENDANT_DIR__#${ATTENDANT_DIR}#g" \
    -e "s#__NODE__#${NODE_BIN}#g" \
    "$SCRIPT_DIR/robo-atendente.service" | sudo tee "$UNIT_PATH" >/dev/null
sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE_NAME"
sudo systemctl restart "$SERVICE_NAME"

# Reinicia o worker se acabamos de adicionar o ATTENDANT_TOKEN nele.
if systemctl is-enabled robo-worker >/dev/null 2>&1; then
  sudo systemctl restart robo-worker || true
fi

IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
cat <<MSG

===================================================================
 Atendente no ar em:  http://${IP:-<ip-do-pi>}:$PORT
 (login do seed: ${ATTENDANT_SEED_EMAIL:-vende@zapien.app} — troque a senha)

 Comandos:
   sudo systemctl status $SERVICE_NAME
   journalctl -u $SERVICE_NAME -f

 No painel, o card "Atendente Zapien" deve ficar VERDE (No ar).
 Ajuste o texto de venda em Configuracoes > Negocio.
===================================================================
MSG
