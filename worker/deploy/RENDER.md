# Rodar o worker na nuvem (Render) — passo a passo

Alternativa ao Raspberry Pi: o worker roda 24/7 no Render e você **só deixa um
celular com o eSIM ligado** (no wifi) como "dono" do número.

> **Custo:** ~US$7/mês (instância Starter) + ~US$0,25/mês (disco 1 GB) ≈ **R$40/mês**.
> Isso é **por serviço** — o plano Pro da sua workspace não inclui compute grátis,
> mas você **não precisa mudar de plano** nem abrir outra conta: é só mais um
> serviço ao lado do Zapien.

## As 3 condições que não podem faltar (o Blueprint já cuida das 2 primeiras)

1. **Instância paga (Starter), nunca a Free** — a free hiberna após 15 min sem
   tráfego e derruba a conexão do WhatsApp. (`plan: starter` no `render.yaml`.)
2. **Disco persistente** — o disco do Render é apagado a cada deploy; sem ele a
   sessão do WhatsApp some e você repareia toda hora. (`disk` em `/var/data`, e
   `WORKER_DATA_DIR` aponta a sessão + SQLite pra lá.)
3. **Um celular com o chip ligado** — o Render roda o software, mas o número
   mora num aparelho real que reconecta de tempos em tempos (~14 dias). Isso
   não muda.

## O chip: eSIM ou físico (tanto faz pro WhatsApp)

O WhatsApp não diferencia eSIM de chip físico — só importa o **número** e o
**código de registro**. Para usar eSIM:

- O **celular precisa suportar eSIM** (muitos baratos/antigos não têm; nesse
  caso um nano-SIM físico faz o mesmo papel).
- Use um **eSIM de operadora de verdade** (um pré-pago normal que é eSIM).
  **Evite** número virtual/eSIM "descartável" de portal de SMS: muitos já vêm
  banidos ou nem recebem o OTP do WhatsApp.
- É um **número dedicado** (descartável) só pro robô, não o seu pessoal.

## Antes de começar (checklist)

- [ ] eSIM ativado num celular e **WhatsApp registrado** nesse número.
- [ ] O número em formato internacional só dígitos (ex.: `5511999999999`).
- [ ] Este repositório conectado à sua conta do GitHub no Render.

## Passo a passo no Render

1. **Dashboard do Render → New (canto superior) → Blueprint.**
2. **Conecte o repositório** `Robo_Comercial` e escolha a **branch** que tem o
   `render.yaml` (a de trabalho atual, ou faça o merge para `main` antes e use
   `main`).
3. O Render lê o `render.yaml` e mostra que vai criar o serviço **robo-worker**
   com um **disco de 1 GB**. Ele vai **pedir o valor de `WA_PAIR_PHONE`**
   (marcado como "sync: false") — digite o número do eSIM (`5511999999999`).
   As demais variáveis já vêm preenchidas; o **`WORKER_API_TOKEN` é gerado
   automaticamente** (você vai copiar ele no passo 6).
4. Clique em **Apply / Create** e aguarde o build + deploy (uns minutos).
5. **Pareie o número:** abra o serviço → aba **Logs**. Vai aparecer um
   **código de 8 dígitos**. No celular do eSIM: WhatsApp → **Aparelhos
   conectados** → **Conectar um aparelho** → **Conectar com número de
   telefone** → digite o código. Nos Logs deve aparecer "WhatsApp conectado".
6. **Pegue a URL e o token:** a URL pública do serviço (ex.:
   `https://robo-worker.onrender.com`) é o `WORKER_URL`. Em **Environment**,
   copie o valor gerado de `WORKER_API_TOKEN`.

## Ligar o painel ao worker

O painel (Next) pode ficar onde você quiser; ele só precisa alcançar o worker.
No `.env` / variáveis do painel, defina:

```
WORKER_URL=https://robo-worker.onrender.com
WORKER_API_TOKEN=<o token gerado no passo 6>
```

- **Painel local:** roda no seu PC apontando pro Render.
- **Painel na Vercel:** as mesmas 2 variáveis no projeto da Vercel.
- **Painel no Render:** crie um 2º web service (rootDir na raiz, build
  `npm ci && npm run build`, start `npm start`) com as mesmas 2 variáveis.

## Conferir se está funcionando

- `https://robo-worker.onrender.com/health` deve responder um JSON com
  `"connected": true` depois do pareamento.
- No painel, o card **🤖 Robô na nuvem (Pi)** mostra 🟢 Conectado, a cota do
  dia e o progresso das campanhas.

## Ressalva honesta: risco de ban

O Render é **datacenter** — o WhatsApp vê IP de datacenter, o que **aumenta o
risco de banir o número** vs. o IP residencial do Pi. Contornável para
prospecção (número descartável + aquecimento + cota + intervalos, tudo já
embutido), mas espere um número mais frágil que no Pi. Comece com a cota baixa
e o warmup ligados (padrão do `render.yaml`).
