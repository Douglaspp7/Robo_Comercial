# Rodar no Raspberry Pi + celular com chip

Setup caseiro: o **Pi fica ligado 24/7** rodando o worker + o painel, e um
**celular com o chip** (físico ou eSIM) segura o número do WhatsApp. Vantagem
sobre a nuvem: **IP residencial**, que o WhatsApp vê como usuário normal —
menos risco de ban.

> Quase nada muda no código em relação à nuvem: é a mesma aplicação Node.
> O Pi só entra no lugar do Render como a "caixa que fica ligada".

## Como as peças se encaixam

- **Pi**: roda o **worker** (segura a sessão do WhatsApp e dispara) e o
  **painel** (a interface web). Fica sempre ligado.
- **Celular com o chip**: registra o WhatsApp e reconecta de tempos em tempos
  (~14 dias). Pode ser um Android baratinho na gaveta, no wifi/carregador.

## Requisitos

- Raspberry Pi (4 recomendado; 2 GB roda, 4 GB+ folgado) com Raspberry Pi OS.
- Node.js 20+ (o 22 vem bem).
- Um celular com o chip e **WhatsApp já registrado** nesse número.
- (Compilar `better-sqlite3`, se não houver binário pronto, precisa de
  `sudo apt install -y build-essential python3`.)

## Passo 1 — o celular (o número)

1. Ponha o chip (nano-SIM **ou** eSIM, se o aparelho suportar) no celular.
2. Registre o WhatsApp normalmente nesse número.
3. Deixe o celular no **wifi + carregador**. Ele só precisa aparecer online de
   vez em quando (regra dos ~14 dias do multi-dispositivo).

> Dica: use um **número dedicado/descartável** pro robô, não o seu pessoal.

## Passo 2 — o worker no Pi

```bash
git clone <seu-repo> && cd Robo_Comercial/worker
bash deploy/setup-pi.sh          # instala deps, cria .env e o servico systemd
nano .env                        # defina WA_PAIR_PHONE=55DDDNUMERO (o número do chip)
sudo systemctl start robo-worker
```

## Passo 3 — o painel no Pi

```bash
cd Robo_Comercial/worker
bash deploy/setup-pi-panel.sh    # builda o painel, cria .env.local e o servico
nano ../.env.local               # preencha GOOGLE_PLACES_API_KEY, IG_*, SMTP_* conforme usar
sudo systemctl restart robo-painel
```

O painel sobe em `http://<ip-do-pi>:3000`. O token do worker é copiado
automaticamente para o painel; se você deixou o worker **sem** token (padrão em
rede local), não precisa fazer nada.

## Passo 4 — conectar o WhatsApp (pelo painel, sem olhar log)

1. No PC/celular na **mesma rede**, abra `http://<ip-do-pi>:3000`.
2. Card **🤖 Robô na nuvem** → **Acompanhar disparos**.
3. Aparece o **código de 8 dígitos** (com botão Copiar). No celular do número:
   WhatsApp → **Aparelhos conectados** → **Conectar um aparelho** →
   **Conectar com número de telefone** → digite o código.
4. O card passa a mostrar 🟢 **Conectado**. Pronto pra disparar.

## Acessar de fora de casa

- **Mesma rede (casa):** `http://<ip-do-pi>:3000` já funciona.
- **Remoto (rua/4G):** instale **Tailscale** no Pi e no seu aparelho — os dois
  entram numa rede privada e você abre `http://<ip-tailscale-do-pi>:3000` de
  qualquer lugar, sem abrir porta no roteador. Não exponha o painel direto na
  internet (ele não tem login).

## Manutenção

- Mantenha o **celular ligado** no wifi; reconecte-o de vez em quando.
- Logs: `journalctl -u robo-worker -f` e `journalctl -u robo-painel -f`.
- Se a sessão cair por logout, apague `worker/data/auth/` e pareie de novo.
- Atualizar o código: `git pull`, depois
  `sudo systemctl restart robo-worker robo-painel` (o painel re-builda só se
  você rodar `npm run build` de novo — ou rode `deploy/setup-pi-panel.sh`).

## Pi × Nuvem (Render) — resumo

| | Pi + celular | Render + celular |
|---|---|---|
| IP / risco de ban | residencial (melhor) | datacenter (pior) |
| Hardware pra cuidar | Pi + celular | só o celular |
| Custo mensal | ~luz | ~R$40 |
| Se cair luz/internet | para | provedor mantém |

Mesmo app nos dois — dá pra começar num e migrar pro outro sem mudar código.
