# Zapien 🤖💬

**SaaS de atendente de vendas com Inteligência Artificial (Claude) para WhatsApp.**

Cada cliente (vendedor) cria sua conta, descreve o próprio negócio por um painel
web e conecta o WhatsApp. A partir daí, a IA atende os clientes dele 24h por dia:
tira dúvidas, contorna objeções e conduz ao **checkout** — enquanto um **dashboard
visual** mostra quantos atendimentos houve e **em que etapa do funil cada contato
está** (contato inicial, dúvida, orçamento, negociação, checkout, fechado, perdido).

> Feito para ser **revendido**: é multi-cliente. Você hospeda uma vez e cada
> comprador usa a própria conta.

---

## ✨ O que tem pronto

- **Multi-cliente (multi-tenant):** cada vendedor tem conta, login e configuração próprios.
- **Painel de configuração:** sem mexer em código — preenche um formulário com o negócio, produtos, FAQ, objeções e regras.
- **Atendimento por IA (Claude):** responde no WhatsApp com base no que cada cliente cadastrou.
- **Entende texto e imagem:** o cliente pode mandar uma foto (a IA "enxerga" via visão do Claude). Áudio é transcrito quando a transcrição está habilitada.
- **Classificação automática do funil:** a cada mensagem, a IA identifica a etapa, a intenção de compra e gera um resumo do contato.
- **Transbordo para humano:** quando o cliente pede uma pessoa (ou a IA não dá conta), o bot pausa aquela conversa e avisa o vendedor no WhatsApp. No painel dá pra "Assumir" e "Devolver à IA".
- **Pagamento via Mercado Pago:** quando o cliente confirma a compra, a IA gera um **link de pagamento real** (Pix, cartão ou boleto) automaticamente — o dinheiro cai na conta do próprio vendedor.
- **Dashboard visual:** números, gráfico de funil, contatos por dia e tabela de todos os atendimentos.
- **Cobrança por assinatura (Stripe):** teste grátis, checkout, portal do cliente e bloqueio automático do bot quando a assinatura fica inativa.
- **Conta de administrador:** painel `/admin.html` para você ver todos os clientes, assinaturas e ativar/desativar contas.
- **Conexão do WhatsApp com 1 clique:** Embedded Signup da Meta (com fallback de configuração manual).
- **Checkout:** link configurável que a IA envia quando há intenção de compra.

> Os recursos opcionais (Stripe, Embedded Signup, transcrição de áudio) **ligam
> sozinhos** quando você preenche as variáveis de ambiente correspondentes. Sem
> elas, o app funciona normalmente sem esses extras.

---

## 🧭 Como funciona

```
Cliente do vendedor (WhatsApp)
        │  mensagem
        ▼
WhatsApp Business Cloud API (Meta) ──webhook──► Zapien
                                                    │
                          identifica o vendedor pelo número (phone_number_id)
                                                    │
                                          Claude (IA) responde + classifica etapa
                                                    │
        ◄────────── resposta enviada ao cliente ────┘
                                                    │
                                   tudo aparece no Dashboard do vendedor
```

---

## 🚀 Hospedando a plataforma (você, o dono)

> ℹ️ O código fica no GitHub, mas este é um app de **servidor** (recebe webhooks,
> chama a IA, tem banco de dados). O **GitHub Pages não roda** este backend.
> Publique num serviço que rode Node.js — sugestão: **Render** (tem o `render.yaml`
> já incluído).

### Deploy no Render (mais fácil)

1. Faça um fork/clone deste repositório para a sua conta do GitHub.
2. Em [render.com](https://render.com), crie um **New → Blueprint** e aponte para o repo.
   O `render.yaml` configura o serviço e um disco persistente para o banco automaticamente.
3. Preencha as variáveis de ambiente (veja a tabela abaixo).
4. Ao terminar, anote a URL pública (ex: `https://zapien.onrender.com`).

### Variáveis de ambiente da plataforma

| Variável | O que é |
|---|---|
| `ANTHROPIC_API_KEY` | Sua chave da Anthropic (uma só atende todos os clientes). |
| `ANTHROPIC_MODEL` | Modelo do Claude. Padrão `claude-haiku-4-5` (o mais rápido e econômico). Use `claude-sonnet-4-6` para respostas mais elaboradas. |
| `WHATSAPP_VERIFY_TOKEN` | Senha que você inventa para o webhook (a mesma vai na Meta). |
| `SESSION_SECRET` | Valor aleatório longo para assinar os cookies de login. |
| `APP_URL` | A URL pública da aplicação (ex: `https://zapien.onrender.com`). |
| `DATABASE_PATH` | Caminho do banco SQLite. Padrão: `./data/zapien.db`. No Render use o disco persistente, ex.: `/var/data/zapien.db` (instalações antigas mantêm o caminho legado já existente). |
| `ADMIN_EMAIL` | E-mail que vira **administrador** (acessa `/admin.html`). Crie a conta com esse e-mail. |

> Variáveis **opcionais** (Stripe, Meta, OpenAI) ficam na seção
> [Recursos opcionais](#-recursos-opcionais-setup-externo) no fim. Sem elas o app
> funciona normalmente.

Rodando localmente para testar:

```bash
npm install
cp .env.example .env   # preencha os valores
npm start              # http://localhost:3000
```

### 👀 Só quero ver as telas (modo demonstração)

Para explorar a interface **sem configurar nada** (sem chaves, sem WhatsApp),
o modo demo sobe o app já populado com dados fictícios:

```bash
npm install
npm run demo
```

Depois abra **http://localhost:3000** e entre com:

- **Login:** `admin@demo.com`
- **Senha:** `123456`

O banco demo (`data/demo.db`) é recriado a cada execução e é separado do banco
real. Nenhuma mensagem é enviada e nenhuma cobrança acontece — é só para você
navegar pelo painel, configurações e área de admin.

---

## 👤 Onboarding de um cliente (o vendedor que comprou de você)

1. Acessa a URL da plataforma e clica em **Criar conta**.
2. Em **Configurações**, descreve o negócio: produtos, preços, FAQ, objeções, tom de voz e o **link de checkout**.
3. Conecta o WhatsApp (passo a passo abaixo) colando o **Phone Number ID** e o **Token**.
4. Pronto — os atendimentos começam a aparecer no **Painel**.

### Conectando o WhatsApp (API oficial da Meta)

No [Meta for Developers](https://developers.facebook.com), com um app do
WhatsApp Business:

1. Copie o **Phone Number ID** e gere um **Token de acesso** → cole na tela de Configurações.
2. Em **WhatsApp → Configuração → Webhook**, cadastre:
   - **Callback URL:** o valor do campo *URL do Webhook* mostrado nas Configurações.
   - **Verify token:** o valor do campo *Verify Token* mostrado nas Configurações.
3. Em **Webhook fields**, assine o campo **`messages`**.

> Cada vendedor conecta o **próprio número**. O sistema identifica de quem é a
> mensagem pelo `phone_number_id` que a Meta envia em cada webhook.

---

## 🗂️ Estrutura do projeto

```
.
├── public/                 # Painel web
│   ├── login.html
│   ├── dashboard.html      # KPIs + gráficos (Chart.js) + contatos + transbordo
│   ├── settings.html       # Configuração do negócio, WhatsApp e assinatura
│   └── admin.html          # Painel do administrador (todos os clientes)
├── src/
│   ├── server.js           # Express: junta tudo (inclui webhook do Stripe)
│   ├── config.js           # Variáveis de ambiente + etapas do funil
│   ├── db.js               # Banco SQLite + migrações + estado da assinatura
│   ├── auth.js             # Cadastro, login, sessões e papel de admin
│   ├── webhook.js          # Recebe mensagens (texto/imagem/áudio), gating e handoff
│   ├── ai.js               # Claude: resposta + classificação + sinal de transbordo
│   ├── whatsapp.js         # Envio de mensagens e download de mídia
│   ├── transcribe.js       # Transcrição de áudio (Whisper, opcional)
│   ├── billing.js          # Stripe: checkout, portal e webhook de assinatura
│   ├── meta.js             # Embedded Signup (troca de token da Meta)
│   └── api.js              # APIs do painel (settings, stats, contatos, billing, admin)
├── render.yaml             # Deploy automático no Render
├── .env.example
└── package.json
```

---

## 🔐 Etapas do funil

`Contato inicial → Tirando dúvidas → Orçamento → Negociação → No checkout → Venda fechada` (ou `Perdido`).
A IA classifica cada contato automaticamente a cada mensagem. Quando o cliente
pede uma pessoa, a etapa não muda, mas o contato é marcado com 🙋 **e o bot pausa
aquela conversa** até você "Devolver à IA" no painel.

---

## ⚙️ Escala e desempenho

Pensado para aguentar muitos clientes conversando ao mesmo tempo:

- **Fila com concorrência controlada:** as respostas de IA são processadas em fila
  (no máximo `AI_CONCURRENCY` por vez, padrão 5), evitando estourar o limite de
  requisições da Anthropic num pico. O webhook responde `200` na hora e processa depois.
- **Prompt caching:** o conhecimento do negócio (system prompt) é cacheado pela
  Anthropic — cobrança ~10x menor nesse trecho e respostas mais rápidas.
- **Debounce por contato:** se o cliente manda várias mensagens seguidas, o bot espera
  um curto silêncio (`DEBOUNCE_MS`, padrão 3s) e responde **uma vez** juntando o contexto
  — mais barato e mais natural.
- **Re-tentativa automática:** o SDK da Anthropic já re-tenta em sobrecarga (429/529).

> Para **dezenas a algumas centenas** de clientes, um único servidor com SQLite atende
> bem. Para volume maior ou múltiplos servidores, migre o banco para PostgreSQL.

### Pagamento via Mercado Pago

Em **Configurações → Pagamento (Mercado Pago)**, cada vendedor cola o próprio
**Access Token** (em mercadopago.com.br → Seu negócio → Configurações → Credenciais).

Quando o cliente confirma a compra, a IA preenche o pedido e o sistema cria uma
**preferência de pagamento** no Mercado Pago, enviando ao cliente um link com
**Pix, cartão e boleto**. O pagamento cai direto na conta do vendedor — a
plataforma não intermedia o dinheiro.

> Se o vendedor não configurar o Mercado Pago, o bot usa o **link de checkout
> manual** (campo "Link de checkout"), como antes.

### Frete pela conversa

Em **Configurações → Frete/entrega** você descreve sua política (ex: "frete grátis
acima de R$200, senão R$ 20"). A IA usa isso na conversa: pergunta o CEP/cidade do
cliente e informa o frete naturalmente, sem integração externa.

---

## 🧩 Recursos opcionais (setup externo)

Tudo abaixo é **opcional** e fica desligado até você preencher as variáveis de
ambiente. Faça depois que a plataforma já estiver no ar.

### 💳 Cobrança por assinatura (Stripe)

Para cobrar dos vendedores automaticamente e bloquear o bot de quem não paga:

1. Crie uma conta na [Stripe](https://stripe.com) e um **produto com preço recorrente** (assinatura).
2. Pegue a **chave secreta** (`STRIPE_SECRET_KEY`) e o **ID do preço** (`STRIPE_PRICE_ID`).
3. Em **Developers → Webhooks**, adicione um endpoint apontando para
   `https://SEU-DOMINIO/stripe/webhook` e assine os eventos
   `checkout.session.completed`, `customer.subscription.updated` e
   `customer.subscription.deleted`. Copie o **signing secret** para `STRIPE_WEBHOOK_SECRET`.
4. (Opcional) `TRIAL_DAYS` define os dias de teste grátis (padrão 7).

Cada cliente vê a seção **Assinatura** nas Configurações para assinar e gerenciar.
Sem assinatura ativa (e fora do teste), o bot **deixa de responder** — mas os leads
continuam sendo registrados.

### ⚡ Conexão do WhatsApp com 1 clique (Meta Embedded Signup)

Para o vendedor conectar o WhatsApp sem colar token manualmente:

1. No seu app da Meta, configure o **WhatsApp Embedded Signup** e uma **configuration**.
2. Preencha `META_APP_ID`, `META_APP_SECRET` e `META_CONFIG_ID`.

O botão **"Conectar WhatsApp com 1 clique"** aparece sozinho nas Configurações.
A configuração manual (Phone Number ID + Token) continua disponível como alternativa.

### 📡 Central de Saúde da Meta (Saúde do WhatsApp)

A página **Integrações** mostra a seção "Saúde do WhatsApp": situação geral da
conexão (Saudável/Atenção/Com problema), número conectado, validade do token,
qualidade do número, último inbound/outbound e templates. Funciona sem nenhuma
configuração extra — usa as credenciais já existentes (do tenant ou da
plataforma) e verifica periodicamente na Graph API.

Variáveis (opcionais, com padrões seguros):

| Variável | O que é |
|---|---|
| `META_HEALTH_ENABLED` | `false` desliga a verificação periódica (a tela continua com verificação manual). Padrão `true`. |
| `META_HEALTH_INTERVAL_MS` | Intervalo da verificação. Padrão `900000` (15 min). |
| `META_HEALTH_CONCURRENCY` | Verificações simultâneas. Padrão `2`. |
| `META_HEALTH_TIMEOUT_MS` | Timeout por chamada à Graph API. Padrão `10000`. |
| `META_WABA_ID` | WABA ID da plataforma (opcional) — habilita a contagem de templates quando a Graph API não expõe o WABA a partir do número. |
| `META_CRITICAL_PUSH_COOLDOWN_MIN` | Cooldown do push de conexão crítica. Padrão `360` (6h). |

### 🔔 Notificações no aparelho (Web Push + PWA)

O painel é uma PWA instalável ("Adicionar à tela inicial") e pode avisar o
lojista no celular quando houver **venda confirmada**, **pedido de atendimento
humano** ou **problema na conexão do WhatsApp**. Os avisos nunca carregam
telefone, dados do cliente ou conteúdo de conversa. Preferências por categoria
ficam em Integrações → Notificações no aparelho.

Para habilitar, gere um par de chaves VAPID e defina:

```bash
npx web-push generate-vapid-keys
# → VAPID_PUBLIC_KEY=...  VAPID_PRIVATE_KEY=...
```

| Variável | O que é |
|---|---|
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Par de chaves do Web Push. Sem elas, o push fica desativado e o painel segue funcionando. |
| `VAPID_SUBJECT` | Contato do responsável (`mailto:...`). |
| `WEB_PUSH_ENABLED` | `false` desliga o push mesmo com chaves preenchidas. |

O service worker (`public/sw.js`) cacheia apenas o shell estático (CSS/JS/
ícones) — **nunca** `/api/*` nem páginas HTML autenticadas.

### ⚡ Automações comerciais (Quando → Se → Então)

A página **Automações** deixa o lojista criar regras simples sem programar:
"Quando um cliente ficar 2 horas sem responder, **se** a intenção de compra for
alta, **então** me avisar e adicionar a tag retorno-pendente". Gatilhos: novo
contato, mudança de etapa/intenção, pedido de humano, checkout enviado,
pagamento aprovado, reposição de produto e cliente parado (persistente —
sobrevive a reinício). As ações incluem tags, mover etapa, pausar/retomar a IA,
aviso interno, push, envio de template aprovado (via fila persistente, plano
Elite+) e disparo do webhook já configurado. Loops são bloqueados por
origem/profundidade de encadeamento, dedupe e cooldown. Limite de automações
**ativas** por plano (`automationMaxActive` em `src/plans.js`): Essencial 2,
Pro 10, Elite 30, Especial 100.

| Variável | O que é |
|---|---|
| `AUTOMATIONS_ENABLED` | `false` desliga o worker e o agendamento. Padrão `true`. |
| `AUTOMATION_CONCURRENCY` / `AUTOMATION_MAX_PER_TENANT` | Concorrência global/por tenant do worker. Padrões `3`/`1`. |
| `AUTOMATION_MAX_ATTEMPTS` / `AUTOMATION_LOCK_TIMEOUT_MS` / `AUTOMATION_POLL_INTERVAL_MS` | Retry, recuperação de lock e polling. |
| `AUTOMATION_MAX_CHAIN_DEPTH` | Profundidade máxima de automação-dispara-automação. Padrão `3`. |

### 🎤 Transcrição de áudio (OpenAI Whisper)

A IA já entende **imagens** nativamente (visão do Claude). Para também entender
**áudios**, defina `OPENAI_API_KEY` — os áudios passam a ser transcritos antes de
ir para a IA. Sem a chave, o bot pede educadamente que o cliente escreva.

### 👑 Administrador

Defina `ADMIN_EMAIL` e crie a conta com esse e-mail. Ela ganha acesso ao
`/admin.html`, onde você vê todos os clientes, o status de assinatura e pode
ativar/desativar contas.

---

## ⚠️ Avisos

- Mantenha o `.env` em segredo (já está no `.gitignore`).
- O banco SQLite atende bem dezenas/centenas de clientes em um único servidor.
  Para escala maior ou múltiplos servidores, migre para PostgreSQL.
- Revise o conteúdo cadastrado por cada cliente para a IA não prometer o que o negócio não cumpre.

Feito com ❤️ para quem vende pelo WhatsApp.
