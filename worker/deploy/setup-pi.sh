#!/usr/bin/env bash
#
# Setup do worker de disparo num Raspberry Pi / servidor Linux com systemd.
# Instala dependencias, cria o .env e instala + habilita o servico systemd.
#
# Uso (de dentro da pasta worker/):
#     bash deploy/setup-pi.sh
#
# Depois: edite o .env, pareie o numero (npm run pair) e ligue o servico.
# Nao precisa rodar como root — o script pede sudo so na parte do systemd.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SERVICE_NAME="robo-worker"
RUN_USER="${SUDO_USER:-$USER}"
NODE_BIN="$(command -v node || true)"

echo "==> Pasta do worker: $WORKER_DIR"
echo "==> Usuario do servico: $RUN_USER"
echo "==> Node: ${NODE_BIN:-NAO ENCONTRADO}"

# 1. Node 20+
if [ -z "$NODE_BIN" ]; then
  echo "ERRO: Node.js nao encontrado. Instale Node 20+ (ex.: via nvm ou nodesource)." >&2
  exit 1
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "ERRO: Node $NODE_MAJOR detectado; o worker precisa de Node 20+." >&2
  exit 1
fi

# 2. Dependencias.
#    better-sqlite3 costuma baixar binario pronto para ARM; se precisar compilar
#    e falhar, instale as ferramentas: sudo apt install -y build-essential python3
echo "==> Instalando dependencias (npm)..."
cd "$WORKER_DIR"
if [ -f package-lock.json ]; then
  npm ci || npm install
else
  npm install
fi

# 3. .env
if [ ! -f "$WORKER_DIR/.env" ]; then
  cp "$WORKER_DIR/.env.example" "$WORKER_DIR/.env"
  echo "==> .env criado a partir do exemplo — EDITE antes de operar."
else
  echo "==> .env ja existe; mantido como esta."
fi

# 4. Servico systemd (precisa de sudo).
UNIT_PATH="/etc/systemd/system/${SERVICE_NAME}.service"
echo "==> Instalando servico em $UNIT_PATH (vai pedir sudo)..."
sed -e "s#__USER__#${RUN_USER}#g" \
    -e "s#__WORKDIR__#${WORKER_DIR}#g" \
    -e "s#__NODE__#${NODE_BIN}#g" \
    "$SCRIPT_DIR/robo-worker.service" | sudo tee "$UNIT_PATH" >/dev/null
sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE_NAME"

cat <<MSG

===================================================================
 Setup concluido. O servico ja sobe sozinho no boot (enabled).
 Antes de LIGAR o disparo, faca 2 coisas:

 1) Configure e pareie o numero:
      nano $WORKER_DIR/.env      # WA_PAIR_PHONE=55DDDNUMERO, cota, token...
      cd $WORKER_DIR && npm run pair
    Digite o codigo de 8 digitos no celular do numero:
    WhatsApp > Aparelhos conectados > Conectar com numero de telefone.

 2) Ligue o servico 24/7:
      sudo systemctl start $SERVICE_NAME
      journalctl -u $SERVICE_NAME -f     # acompanhar os logs ao vivo

 3) (Opcional) Suba o PAINEL no mesmo Pi:
      bash deploy/setup-pi-panel.sh
    Depois conecte o WhatsApp pelo proprio painel (ver deploy/PI.md).

 Outros comandos uteis:
      sudo systemctl status $SERVICE_NAME
      sudo systemctl restart $SERVICE_NAME
      sudo systemctl stop $SERVICE_NAME
===================================================================
MSG
