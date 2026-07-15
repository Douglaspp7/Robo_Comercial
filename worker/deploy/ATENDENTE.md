# Atendente que vende Zapien (número dedicado: disparo + atendimento)

Este guia liga o **disparo frio** (worker) a um **atendente Zapien completo**
(dashboard + assumir conversa) no **mesmo número**, de modo que **qualquer
palavra que o lead responder ativa o robô** — sem código de tenant.

## Como funciona (visão geral)

```
Lead  ⇄  chip A / chip B   (Baileys, dono = WORKER)

  1. WORKER dispara o abridor frio (anti-ban, pool de leads, agendador).
  2. Lead responde "oi/sim/quanto?" → WORKER encaminha p/ o ATENDENTE (/inbound).
  3. ATENDENTE (cópia do Zapien, modo gateway) pensa e responde pelo MESMO chip
     via /send do WORKER — dashboard, funil e "assumir conversa" nativos.
```

- **Ledgers separados, ligados só pelo telefone:** o worker sabe "quem eu já
  abordei" (dedup, cota, não-recontatar); o atendente sabe "a conversa"
  (histórico, funil, handoff). Não compartilham banco.
- **2 chips:** cada lead "pertence" ao chip que o abordou (`contacts.chip_id`).
  A resposta do atendente sempre volta por esse chip — o lead nunca vê dois
  números.

## Ban do número central do Zapien: **não é afetado**

O atendente roda em modo gateway e **não tem as credenciais Meta** do Zapien de
produção. Todo o disparo frio (a atividade de risco) acontece **só nos chips
dedicados**. Se um chip cair, você perde o chip — nunca o número oficial nem os
clientes pagantes. Dois cuidados: (1) não vincule os chips e o número central no
mesmo WhatsApp Business/Meta Business Manager; (2) mantenha os 2 chips em cota
moderada (~60/dia cada por padrão; o worker já faz com cota + aquecimento por
número).

## Variáveis que ligam os dois lados

| No WORKER (`worker/.env`)      | No ATENDENTE (`atendente/.env`)          |
|--------------------------------|------------------------------------------|
| `ATTENDANT_URL` = URL do atendente | `WORKER_URL` = URL do worker         |
| `ATTENDANT_TOKEN` = segredo X  | `ATTENDANT_TOKEN` = **mesmo** segredo X  |
| `WORKER_API_TOKEN` = segredo Y | `WORKER_API_TOKEN` = **mesmo** segredo Y |
| `WA_NUMBERS` = chipA,chipB     | `GATEWAY_MODE=1`                         |

No atendente ainda: `ANTHROPIC_API_KEY` (pode ser a mesma do Zapien),
`DATABASE_PATH`, `DATA_ENCRYPTION_KEY`, `SESSION_SECRET`, `APP_URL`,
`ATTENDANT_TENANT_ID` (ver seed abaixo). **Próprios deste número** — nunca
reaproveite o `DATA_ENCRYPTION_KEY`/banco de produção.

## Criar o tenant "Zapien vende Zapien"

Uma vez, no ambiente do atendente (modo gateway):

```bash
cd atendente
ATTENDANT_SEED_EMAIL=vende@zapien.app ATTENDANT_SEED_PASSWORD='troque-isto' \
  node scripts/seed-zapien-tenant.mjs
# → imprime TENANT_ID=...  (cole em ATTENDANT_TENANT_ID)
```

Depois, entre no painel do atendente com esse login e ajuste o texto de venda em
**Configurações → Negócio** (o seed deixa só um rascunho). É onde você define o
que o robô fala pra vender o Zapien.

## Deploy no Render

O `render.yaml` na raiz já descreve os 3 serviços: `robo-worker`,
`robo-painel` e `robo-atendente`. Passos:

1. Suba os serviços (Blueprint). `WORKER_API_TOKEN` e `ATTENDANT_TOKEN` são
   gerados no worker e compartilhados automaticamente com o atendente.
2. Preencha os `sync:false`: no atendente `ANTHROPIC_API_KEY`, `APP_URL`,
   `ADMIN_EMAIL`, `WORKER_URL`, `ATTENDANT_TENANT_ID`; no worker `WA_NUMBERS`
   (os 2 chips) e `ATTENDANT_URL`.
3. Rode o seed (Shell do serviço `robo-atendente`) e cole o `TENANT_ID`.
4. Pareie os 2 chips pelo painel (QR/código) e mande um disparo de teste.

## Deploy no Raspberry Pi / servidor

Além do worker e do painel (ver `PI.md`), rode o atendente como serviço:

```bash
cd atendente && npm ci
cp .env.example .env   # edite: GATEWAY_MODE=1, WORKER_URL, tokens, ANTHROPIC_API_KEY, DATABASE_PATH
node scripts/seed-zapien-tenant.mjs   # cole o TENANT_ID no .env (ATTENDANT_TENANT_ID)

sudo cp ../worker/deploy/robo-atendente.service /etc/systemd/system/robo-atendente.service
# edite __USER__, __ATTENDANT_DIR__ (caminho da pasta atendente/) e __NODE__ (which node)
sudo systemctl daemon-reload && sudo systemctl enable --now robo-atendente
journalctl -u robo-atendente -f
```

No `.env` do **worker** preencha `ATTENDANT_URL=http://localhost:<porta-do-atendente>`
e `ATTENDANT_TOKEN` (o mesmo do atendente).

## Checagem rápida

- Worker `/health` conectado nos 2 chips.
- Enviar "oi" para um dos chips → aparece uma conversa nova no dashboard do
  atendente, com resposta da IA saindo pelo mesmo chip.
- "Assumir conversa" no dashboard silencia a IA e deixa você responder (nativo
  do Zapien).
