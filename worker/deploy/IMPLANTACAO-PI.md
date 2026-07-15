# Implantação no Raspberry Pi — do zero ao funcionando

Guia único, passo a passo, para rodar **tudo** num Raspberry Pi (ou qualquer
servidor Linux com systemd): o **disparo** frio + um **atendente Zapien
completo** (dashboard + assumir conversa) no **mesmo número dedicado**, com
**2 chips** para escala. Ao final há a lista de **chaves necessárias**.

> Por que Pi: o IP residencial é mais seguro contra ban do que datacenter, e o
> Pi segura a sessão do WhatsApp 24/7. O número central do Zapien de produção
> **não é tocado** — todo o risco fica nos chips dedicados.

---

## 0. Visão geral — o que vai rodar

Três serviços systemd no mesmo Pi:

| Serviço          | O que é                                   | Porta padrão |
|------------------|-------------------------------------------|--------------|
| `robo-worker`    | Disparo (Baileys, dono dos 2 chips)       | 8787         |
| `robo-painel`    | Painel web (buscar leads, disparar, ver conexão) | 3000  |
| `robo-atendente` | Cópia do Zapien que vende Zapien (gateway) | 3001        |

Fluxo: o **worker** dispara → o lead responde → o worker encaminha ao
**atendente** → o atendente responde pelo **mesmo chip** e a conversa aparece no
**dashboard** dele. Ledgers separados, ligados só pelo telefone.

---

## 1. Hardware e sistema

- **Raspberry Pi 4** (2GB+; 4GB recomendado) + cartão de 32GB+ (ou SSD USB).
- **Raspberry Pi OS 64-bit** (Bookworm). Grave com o Raspberry Pi Imager, já
  habilitando **SSH** e o Wi-Fi/rede.
- Acesse por SSH: `ssh pi@<ip-do-pi>`.

> Os 2 chips ficam **num celular** (dual-SIM) que registra o WhatsApp e recebe o
> OTP uma vez; o Pi segura a sessão. O celular precisa reconectar à internet a
> cada ~14 dias (regra do WhatsApp multi-dispositivo).

---

## 2. Pré-requisitos (uma vez)

```bash
# Node 20+ (recomendado 22). Ex.: via nodesource
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git build-essential
node -v   # deve ser >= 20
```

Clone o repositório (na home do usuário):

```bash
cd ~
git clone https://github.com/Douglaspp7/Robo_Comercial.git
cd Robo_Comercial
```

---

## 3. ⭐ Chaves necessárias (a lista)

Prepare estas chaves **antes**. As **obrigatórias** são o mínimo para o disparo +
atendente venderem; as **opcionais** ligam fontes/canais extras.

### Obrigatórias

| Chave | Onde obter / como gerar | Vai em |
|-------|-------------------------|--------|
| `ANTHROPIC_API_KEY` | console.anthropic.com → API Keys. **Pode ser a mesma do Zapien.** | atendente |
| `GOOGLE_PLACES_API_KEY` | Google Cloud Console → ative **Places API** → Credenciais → Chave de API | painel |
| `WORKER_API_TOKEN` | Você inventa: `openssl rand -hex 24` | worker + painel + atendente (o **mesmo** valor) |
| `ATTENDANT_TOKEN` | Você inventa: `openssl rand -hex 24` | worker + atendente (o **mesmo** valor) |
| `DATA_ENCRYPTION_KEY` | Gere **novo** (não reutilize o do Zapien): `openssl rand -hex 32` | atendente |
| `SESSION_SECRET` | Gere **novo**: `openssl rand -base64 32` | atendente |
| `WA_NUMBERS` | Os telefones dos **2 chips** (formato internacional, só dígitos), separados por vírgula. Ex.: `5511999990001,5511999990002` | worker |
| `ATTENDANT_TENANT_ID` | Sai do seed (passo 6). | atendente |

### Opcionais

| Chave | Para quê | Vai em |
|-------|----------|--------|
| `IG_ACCESS_TOKEN` + `IG_BUSINESS_ID` | Buscar leads também no **Instagram** | painel |
| `SMTP_EMAIL` + `SMTP_PASSWORD` | Enviar **e-mail** (além do WhatsApp) | painel |
| `ANTHROPIC_MODEL` | Trocar o modelo (padrão `claude-haiku-4-5`) | atendente |
| `ADMIN_EMAIL` | Seu e-mail (vira admin do painel do atendente) | atendente |

> **Nunca** comite `.env` nem essas chaves. Os `.env` já são ignorados pelo git.
> `DATA_ENCRYPTION_KEY` e `SESSION_SECRET` do atendente são **próprios** deste
> número — não use os de produção do Zapien.

---

## 4. Worker (disparo)

```bash
cd ~/Robo_Comercial/worker
bash deploy/setup-pi.sh          # instala deps e cria o serviço robo-worker
```

Edite `~/Robo_Comercial/worker/.env`:

```ini
WORKER_API_TOKEN=<mesmo token gerado>
WA_NUMBERS=5511999990001,5511999990002   # seus 2 chips
WA_DAILY_LIMIT=40                         # por chip (2 chips = 80/dia no total)
WA_WARMUP_RAMP=5,10,20                    # aquecimento nos primeiros dias
PANEL_URL=http://localhost:3000
ATTENDANT_URL=http://localhost:3001       # onde o atendente vai rodar
ATTENDANT_TOKEN=<mesmo token gerado>
# Anti-ban (opcionais, bons padrões):
WA_SEND_WINDOW=9-19
WA_RECONTACT_DAYS=30
```

Suba o serviço:

```bash
sudo systemctl enable --now robo-worker
journalctl -u robo-worker -f          # acompanha os logs
```

---

## 5. Painel (web)

```bash
cd ~/Robo_Comercial/worker
bash deploy/setup-pi-panel.sh         # build + serviço robo-painel (porta 3000)
```

Edite o `.env.local` do painel (na **raiz** do repo, `~/Robo_Comercial/.env.local`):

```ini
WORKER_URL=http://localhost:8787
WORKER_API_TOKEN=<mesmo token do worker>
ATTENDANT_URL=http://localhost:3001    # mostra o card do atendente no painel
GOOGLE_PLACES_API_KEY=<sua chave>
# Opcionais:
# IG_ACCESS_TOKEN=...
# IG_BUSINESS_ID=...
# SMTP_EMAIL=...
# SMTP_PASSWORD=...
```

```bash
sudo systemctl restart robo-painel
```

Acesse o painel em `http://<ip-do-pi>:3000`.

---

## 6. Atendente (Zapien que vende Zapien)

### Jeito fácil (script) — recomendado

Um comando faz tudo: instala deps, **gera os segredos próprios**, puxa os
tokens do worker, cria o `.env`, roda o **seed** e sobe o serviço. Basta passar
a chave da IA:

```bash
cd ~/Robo_Comercial/worker
ANTHROPIC_API_KEY=sk-ant-... ADMIN_EMAIL=voce@exemplo.com \
  bash deploy/setup-pi-atendente.sh
```

Se rodar sem a `ANTHROPIC_API_KEY`, o script cria o `.env` com tudo pronto e só
avisa para você preencher a chave e rodar o seed depois. **Pulando para o passo
7** (parear os chips) se usou o script. O passo manual abaixo é a alternativa.

### Jeito manual (alternativa)

```bash
cd ~/Robo_Comercial/atendente
npm ci
cp .env.example .env
```

Gere os segredos próprios e edite `~/Robo_Comercial/atendente/.env`:

```bash
echo "DATA_ENCRYPTION_KEY=$(openssl rand -hex 32)"
echo "SESSION_SECRET=$(openssl rand -base64 32)"
```

```ini
GATEWAY_MODE=1
PORT=3001
NODE_ENV=production
ANTHROPIC_API_KEY=<sua chave (pode ser a do Zapien)>
ANTHROPIC_MODEL=claude-haiku-4-5
ADMIN_EMAIL=voce@exemplo.com
DATABASE_PATH=/home/pi/Robo_Comercial/atendente/data/atendente.db
DATA_ENCRYPTION_KEY=<gerado acima>
SESSION_SECRET=<gerado acima>
APP_URL=http://localhost:3001
WORKER_URL=http://localhost:8787
WORKER_API_TOKEN=<mesmo token do worker>
ATTENDANT_TOKEN=<mesmo token do worker>
ATTENDANT_TENANT_ID=          # preenchido pelo seed, logo abaixo
```

Crie o tenant "Zapien vende Zapien" (imprime o `TENANT_ID`):

```bash
ATTENDANT_SEED_EMAIL=vende@zapien.app ATTENDANT_SEED_PASSWORD='troque-isto' \
  node --env-file=.env scripts/seed-zapien-tenant.mjs
# → copie o TENANT_ID=... para ATTENDANT_TENANT_ID no .env
```

Instale o serviço systemd:

```bash
sudo cp ~/Robo_Comercial/worker/deploy/robo-atendente.service \
        /etc/systemd/system/robo-atendente.service
# Edite os placeholders do arquivo:
#   __USER__          -> pi (ou seu usuário)
#   __ATTENDANT_DIR__ -> /home/pi/Robo_Comercial/atendente
#   __NODE__          -> saída de: which node
sudo nano /etc/systemd/system/robo-atendente.service
sudo systemctl daemon-reload
sudo systemctl enable --now robo-atendente
journalctl -u robo-atendente -f
```

Ajuste o **texto de venda** entrando no painel do atendente
(`http://<ip-do-pi>:3001`) com o login do seed → **Configurações → Negócio**.

---

## 7. Parear os 2 chips

No painel (`http://<ip-do-pi>:3000`), seção **Robô na nuvem** → **Acompanhar
disparos**: cada chip mostra um **QR** (ou **código** de pareamento). No celular
dual-SIM: WhatsApp → Dispositivos conectados → Conectar → escaneie/insira o
código, um chip de cada vez. Quando os dois ficarem **verdes**, estão prontos.

---

## 8. Verificação ponta a ponta

1. **Worker no ar:** `curl http://localhost:8787/health` → `connected: true` e os
   2 números conectados.
2. **Painel:** abra `:3000`, faça uma busca (Google Maps) e um **disparo de
   teste** para o seu próprio número.
3. **Card do atendente:** na home do painel, o card **💬 Atendente Zapien** deve
   mostrar **🟢 No ar**.
4. **Resposta → atendimento:** responda "oi" a partir do número que recebeu o
   teste → em segundos a conversa aparece no **dashboard do atendente** (`:3001`)
   com a resposta da IA saindo pelo **mesmo chip**.
5. **Assumir conversa:** no dashboard, "assumir" silencia a IA e você responde.

---

## 9. Operação, segurança e anti-ban

- **Logs:** `journalctl -u robo-worker -f` (idem `robo-painel`, `robo-atendente`).
- **Reiniciar:** `sudo systemctl restart robo-worker` (etc.).
- **Reconexão do chip:** o celular com os SIMs precisa ver a internet a cada
  ~14 dias, senão o WhatsApp desconecta a sessão vinculada.
- **Anti-ban:** mantenha `WA_DAILY_LIMIT` ~40 por chip (2 chips = 80/dia),
  aquecimento nos primeiros dias, janela de horário (`WA_SEND_WINDOW`) e não
  recontatar (`WA_RECONTACT_DAYS`). Opt-out (SAIR/PARAR) já suprime sozinho.
- **Número central do Zapien:** intocado — o atendente é uma cópia sem
  credenciais Meta; o risco fica todo nos chips dedicados. Não vincule os chips
  e o número central no mesmo WhatsApp Business/Meta Business Manager.
- **Backup:** o banco do atendente é `atendente/data/atendente.db`; a sessão dos
  chips fica em `worker/data/`. Faça cópia periódica desses diretórios.

---

## 10. Resumo dos "mesmos valores" (não erre o wiring)

- `WORKER_API_TOKEN` — **igual** em worker, painel e atendente.
- `ATTENDANT_TOKEN` — **igual** em worker e atendente.
- `ATTENDANT_URL` (`http://localhost:3001`) — no worker e no painel.
- `WORKER_URL` (`http://localhost:8787`) — no painel e no atendente.
- `ATTENDANT_TENANT_ID` — o `TENANT_ID` que o seed imprimiu.

Se algo não conversar, é quase sempre um desses cinco fora de sincronia.
