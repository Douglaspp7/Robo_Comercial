# Rodar o worker na nuvem (Render)

Alternativa ao Raspberry Pi: o worker roda 24/7 no Render e você **só deixa o
celular com o chip ligado** (no wifi, numa gaveta) como "dono" do número.

> **Custo realista:** ~US$7/mês (instância Starter) + centavos do disco ≈ **R$40/mês**.

## As 3 condições que NÃO podem faltar

1. **Instância paga (Starter), nunca a Free.** A free do Render **hiberna** após
   15 min sem tráfego — isso derruba a conexão do WhatsApp. Só a paga fica
   sempre ligada.
2. **Disco persistente.** O sistema de arquivos do Render é apagado a cada
   deploy. Sem um **disco** montado, a sessão do WhatsApp some e você tem que
   parear de novo toda hora. O `render.yaml` já cria um disco em `/var/data` e
   aponta `WORKER_DATA_DIR` para lá (mesmo padrão que o Zapien usa pro SQLite).
3. **O celular continua obrigatório.** O Render roda o *software*, mas o
   **número** precisa morar num aparelho real que reconecta de tempos em tempos
   (regra dos ~14 dias do multi-dispositivo). Isso não muda.

## Passo a passo

1. No Render: **New → Blueprint**, aponte para este repositório. Ele lê o
   `render.yaml` da raiz e cria o serviço **robo-worker** com o disco.
2. Nas variáveis do serviço, preencha **`WA_PAIR_PHONE`** com o número do chip
   em formato internacional só dígitos (ex.: `5511999999999`). As demais já vêm
   com padrão; `WORKER_API_TOKEN` é gerado automaticamente (anote-o).
3. Faça o deploy. Abra a aba **Logs** do serviço: vai aparecer o
   **código de pareamento de 8 dígitos**.
4. No celular do número: WhatsApp → **Aparelhos conectados** → **Conectar um
   aparelho** → **Conectar com número de telefone** → digite o código.
5. Pronto: o worker está no ar. A URL pública do serviço (ex.:
   `https://robo-worker.onrender.com`) é o `WORKER_URL` que o painel usa.

## Onde fica o painel?

O painel (Next) pode ficar em qualquer lugar; ele só precisa alcançar o worker:

- **Opção simples:** rode o painel onde quiser (Vercel, ou local) e configure
  no `.env` dele: `WORKER_URL=https://robo-worker.onrender.com` e
  `WORKER_API_TOKEN=<o token gerado>`. Aí "Disparar na nuvem" e o painel de
  acompanhamento falam com o worker no Render.
- **Tudo no Render:** crie um segundo serviço web para o painel (rootDir na
  raiz, `npm ci` + `npm run build` + `npm start`) com as mesmas duas variáveis.

> **Segurança:** como a API do worker fica pública no Render, mantenha o
> `WORKER_API_TOKEN` definido (o `/health` é aberto, o resto exige o token).

## Ressalva honesta: risco de ban

O Render é **datacenter** — o WhatsApp vê IP de datacenter, o que **aumenta o
risco de banir o número** em comparação com o IP residencial do Pi. Para
prospecção isso é contornável (número descartável + aquecimento + cota + os
intervalos que já existem), mas espere um número mais frágil que no Pi. Se
segurança do número for prioridade máxima, o Pi ainda é mais seguro.
