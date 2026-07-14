# Worker de disparo (WhatsApp na nuvem / Raspberry Pi)

Roda o disparo de WhatsApp **24/7 no servidor**, sem depender do PC ligado nem
do autoclicker AutoHotkey. Substitui o fluxo `wa.me` + macro por uma **sessão
real do WhatsApp** (Baileys, dispositivo vinculado), com fila persistente,
cota diária e cadência humana.

> ⚠️ **Uso responsável.** Disparo automático viola o espírito dos Termos do
> WhatsApp e **volume alto derruba número**. Use número dedicado (descartável),
> respeite a cota/aquecimento, sempre com opt-out. Rodar num **IP residencial**
> (ex.: Pi na sua internet de casa) é mais seguro que num VPS de datacenter.

## Como as peças se encaixam

- **Painel Next** (`../`): busca de leads (Google Places, Excel) e seleção.
- **Este worker**: recebe os contatos, mantém a sessão do WhatsApp e envia.
- **Chip/número**: registrado num celular (ou HAT LTE) — o worker só **vincula**
  a esse número. Ver a seção "O chip" abaixo.

O painel fala com o worker por HTTP (padrão `http://<pi>:8787`).

## Requisitos

- Node.js ≥ 20 (o Pi vem bem com o 22).
- Um número de WhatsApp **já registrado** num aparelho (o worker entra como
  aparelho vinculado, igual ao WhatsApp Web).

## Instalação (no Pi)

**Setup automatizado (recomendado):** instala dependências, cria o `.env` e
já instala + habilita o serviço systemd:

```bash
cd worker
bash deploy/setup-pi.sh
```

Ao final ele mostra os próximos passos (editar `.env`, parear, ligar). Depois
é só parear o número e `sudo systemctl start robo-worker`.

**Manual:**

```bash
cd worker
npm install
cp .env.example .env      # ajuste cota, intervalo, token...
```

## Parear o número (uma vez)

**Pi sem tela — pareamento por código (recomendado):** no `.env`, defina
`WA_PAIR_PHONE` com o número em formato internacional só dígitos
(ex.: `5531999990001`) e rode:

```bash
npm run pair
```

Aparece um **código de 8 dígitos**. No celular do número:
WhatsApp › **Aparelhos conectados** › **Conectar um aparelho** ›
**Conectar com número de telefone** › digite o código. Ao conectar, o worker
manda uma mensagem de teste para si mesmo e confirma que está tudo certo.

**Com tela — QR:** deixe `WA_PAIR_PHONE` vazio e rode `npm run pair`; escaneie
o QR que aparece no terminal.

A sessão fica salva em `data/auth/` — **não precisa parear de novo** após
reboot. (Se cair por logout, apague `data/auth/` e pareie outra vez.)

## Rodar

```bash
npm start
```

Sobe a API (`WORKER_PORT`, padrão 8787), conecta o WhatsApp e inicia o loop.

### Rodar sempre (systemd no Pi)

O jeito fácil é o `bash deploy/setup-pi.sh` (acima), que instala o serviço
por você a partir de `deploy/robo-worker.service`, preenchendo usuário,
caminho e o binário do Node automaticamente.

Comandos do dia a dia:

```bash
sudo systemctl start robo-worker      # ligar
sudo systemctl status robo-worker     # ver estado
journalctl -u robo-worker -f          # logs ao vivo
sudo systemctl restart robo-worker    # reiniciar
```

Para instalar na mão, copie `deploy/robo-worker.service` para
`/etc/systemd/system/`, troque os placeholders `__USER__` / `__WORKDIR__` /
`__NODE__` pelos valores reais e rode `sudo systemctl enable --now robo-worker`.

## API (o painel consome)

| Método | Rota | O que faz |
|--------|------|-----------|
| GET  | `/health` | Estado da conexão + cota do dia (liberado, sem token) |
| GET  | `/qr` | QR ou código de pareamento atual |
| GET  | `/status` | Campanhas + progresso (enviados/pendentes/falhas) |
| POST | `/campaigns` | Cria campanha `{name, message, app_url, contacts:[{id,name,phone}]}` |
| POST | `/control` | `{action:"pause"\|"resume"}` — pausa/retoma tudo |
| POST | `/campaigns/:id/status` | `{action:"pause"\|"resume"\|"cancel"}` |

Se `WORKER_API_TOKEN` estiver definido, envie o header `x-worker-token`
(exceto em `/health`). `message` aceita `{nome}` e a `app_url` é anexada ao
final — igual ao painel hoje.

## O chip (eSIM ou SIM físico)

O chip **não vai dentro do Pi/servidor** — ele dá o número e recebe o SMS de
registro num aparelho. Depois, o worker roda com a **sessão** salva.

- **Montagem simples:** chip num celular Android baratinho (eSIM *ou* nano-SIM),
  WhatsApp registrado nele, celular no carregador/wifi. Ele é o "dono" do número
  e precisa reconectar de tempos em tempos (regra dos ~14 dias do WhatsApp
  multi-dispositivo). O Pi dispara 24/7.
- **eSIM vs SIM físico:** para o WhatsApp dá no mesmo. Celular barato costuma
  **não** ter eSIM — nesse caso um **nano-SIM dedicado** é mais simples/barato.
- **Evite** números virtuais descartáveis de portais de SMS: muitos já vêm
  reciclados/banidos no WhatsApp.

## Configuração (.env)

Ver `.env.example`. Principais: `WA_DAILY_LIMIT` (cota/dia), `WA_WARMUP_RAMP`
(aquecimento de número novo), `WA_MIN_DELAY_SEC`/`WA_MAX_DELAY_SEC` (cadência),
`WORKER_API_TOKEN` (proteção da API), `WA_PAIR_PHONE` (pareamento por código).
