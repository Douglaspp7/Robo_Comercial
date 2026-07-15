# Zapien

SaaS de atendente de vendas com IA (Claude) para WhatsApp. Foco: pequenos vendedores,
e-commerce e revenda que atendem clientes e fecham vendas pelo WhatsApp. Multi-tenant
(cada lojista é um "tenant" isolado por `tenant_id`), roteado por um único número
WhatsApp da plataforma.

**O que o Zapien É**: uma central inteligente que organiza atendimento, catálogo, frete,
pagamento e clientes para o lojista vender mais pelo WhatsApp — direto, simples, focado
em venda prática.

**O que o Zapien NÃO é**: CRM genérico, plataforma white-label, rede social, ferramenta
complexa de agência. Ao adicionar funcionalidades, prefira o termo mais simples e
comercial ("Painel de Vendas", "Cliente", "Pedido") em vez do termo técnico
("Kanban", "pipeline", "ticketing system").

## Stack

- Node.js 22, Express 4, ESM (`"type": "module"`) — sem framework de frontend, HTML/JS/CSS vanilla.
- SQLite via `better-sqlite3` (WAL mode), sem ORM — schema e migrations em `src/db.js`.
- Claude (`@anthropic-ai/sdk`) para a IA de atendimento; OpenAI Whisper opcional (áudio).
- Integrações reais: WhatsApp (Meta Cloud API + Z-API + Evolution API como alternativas),
  Mercado Pago (checkout de vendas do lojista + preapproval para cobrar o próprio Zapien),
  Melhor Envio (frete), Stripe (billing alternativo, opcional/desligado por padrão).
- Deploy: Render (`render.yaml`), disco persistente para o SQLite. Domínio público
  `zapien.app` aponta pro app no Render; landing/domínio via Hostinger DNS.

## Comandos

```
npm install       # instalar dependências
npm run dev        # servidor com --watch (desenvolvimento)
npm start          # servidor de produção
npm test           # node --test test/*.test.js
npm run lint        # eslint src/ scripts/ test/
npm run check       # lint + test (rodar antes de todo PR)
npm run backup      # backup manual do SQLite
```

Testes usam `test/_setup.js` (import estático, sem top-level await) para isolar
`DATABASE_PATH` num SQLite temporário — nunca roda contra o banco real (`./data/zapien.db`).

## Estrutura de pastas

```
src/
  server.js        # wiring do Express
  api.js           # (maior arquivo) quase todas as rotas autenticadas: settings,
                    # contatos, sales, handoff, admin, billing, Melhor Envio, MP
  webhook.js        # webhook inbound do WhatsApp, dedup, debounce, handoff, processTurn
  ai.js             # system prompt, tools da IA (responder_cliente, escalar_para_humano,
                    # calcular_frete), parsing de catálogo (PDF/imagem)
  db.js             # schema, migrations (ensureColumn), todas as prepared statements
  business.js        # normalizeBusiness() — schema canônico de business_json
  config.js          # env config + STAGES/STAGE_IDS (etapas do funil)
  plans.js / usage.js # limites por plano e apuração de uso (IA, áudio, storage, docs)
  whatsapp.js / zapi.js / evolution.js / evo-*.js  # gateways WhatsApp (Meta/Z-API/Evolution)
  mercadopago.js / melhorenvio.js / billing.js      # integrações de pagamento/frete
  auth.js, csrf.js, crypto.js, ssrf.js, urlsign.js, limiters.js  # segurança/infra
  followup.js, conversation-guard.js, alerts.js, queue.js, debounce.js  # automações/operação
public/
  dashboard.html + js/pages/dashboard.js   # Visão Geral: só o que envolve a conversa —
                                           # banners, central de prioridades, relatório de
                                           # valor da IA, KPIs de atendimento, contatos +
                                           # drawer de conversa (Cadastro/CRM, Notas, Histórico)
  vendas.html + js/pages/vendas.js         # Painel de Vendas: tudo que é financeiro/comercial —
                                           # dinheiro parado, board do funil por etapa, gráfico
                                           # do funil, vendas/pedidos, vendas por origem/tipo
  settings.html + js/pages/settings.js     # negócio, produtos, catálogo, docs extras, uso
  admin.html + js/pages/admin.js           # painel master: tenants, plano, uso, ações
  plans.html, login.html, landing.html
test/               # node --test, um arquivo por módulo espelhando src/
```

## Contexto do funil (já existe — não duplicar)

Etapas (`STAGE_IDS` em `src/config.js`): `novo_contato → duvida → orcamento →
negociacao → checkout → fechado` (+ `perdido`). O campo `contacts.stage` é escrito
**pela IA** via `etapa` no tool `responder_cliente`, mas também pode ser movido
manualmente no Painel de Vendas (`POST /api/contacts/:phone/stage`). Existe uma tabela
`sales` (pedidos) separada, criada quando a IA preenche o campo `pedido`. O Painel de
Vendas mostra o funil tanto como board por etapa (`GET /api/pipeline`, cards com
"mover para...") quanto como gráfico de barras (`funnelChart`).

Handoff humano já existe: `contacts.handoff_status` (`none|waiting|in_progress`) +
`handoff_reason`, disparado pelo tool `escalar_para_humano` da IA (motivos: pediu
humano, reclamação, pós-venda, sem informação, irritado, dado sensível, limite de IA).
A Visão Geral mostra badge e lista de prioridade para quem está aguardando humano; o
drawer de conversa só existe lá — o Painel de Vendas linka pra
`/dashboard.html?contact=<telefone>` (e `&assumir=1` quando o link deve assumir a
conversa) em vez de duplicar a conversa na página de vendas.

Tags inteligentes, origem do lead, CPF/CNPJ (mascarado, com validação de checksum),
"próxima melhor ação" e templates por nicho já existem — ver `src/auto-tags.js`,
`src/cpf-cnpj.js`, `src/next-action.js`, `src/niche-templates.js`. Ao adicionar algo
nessas áreas, verifique sempre se já existe antes de criar um módulo novo.

## Regras de desenvolvimento

- Mudanças incrementais. Nunca reescrever um arquivo grande do zero quando um Edit
  cirúrgico resolve — `api.js`, `db.js` e `webhook.js` são grandes e centrais; qualquer
  regressão neles derruba o app inteiro.
- `db.js`: toda coluna nova usa `ensureColumn()` (migração idempotente), nunca
  `ALTER TABLE` solto. Nunca remova coluna/tabela existente sem migração de dados.
  Nunca use dados sensíveis (CPF completo, tokens) em logs.
- `business_json` é a fonte única de config do negócio — sempre passar por
  `normalizeBusiness()` ao ler/gravar, nunca acessar chaves legadas diretamente.
  Limites de plano vêm sempre de `src/plans.js` (`getPlanLimits`), nunca hardcode
  números de plano em outro arquivo.
- Rodar `npm run check` antes de qualquer commit. Testes cobrem principalmente
  `plans`, `usage`, `handoff`, `guard`, `security`, `ssrf`, `urlsign`, `http`, `routing`,
  `business`, `alerts` — ao tocar essas áreas, atualizar/adicionar teste correspondente.

## Regras de design e UX

- Mobile-first, visual SaaS brasileiro claro e moderno — sem aparência de CRM
  corporativo ou planilha. Bom contraste nos botões principais, cards claros, ações
  rápidas (copiar mensagem, aplicar sugestão, mover etapa).
- Microcopy simples e comercial: "Painel de Vendas", "Precisa de humano", "Próxima
  melhor ação", "Cliente aguardando pagamento", "Copiar resposta". Evitar termos
  técnicos na interface (Kanban, pipeline, lead scoring, ticketing, workflow).
- Nunca expor CPF/CNPJ completo, token ou segredo em card, lista ou log — sempre
  mascarado por padrão, completo só em edição explícita.

## Deploy, Render, GitHub, domínio

- Deploy é automático: push/merge em `main` no GitHub dispara build no Render
  (`render.yaml`). Não há acesso a credenciais do Render neste ambiente de execução —
  não tentar curlar `zapien.app`/`onrender.com` nem assumir sucesso de deploy sem
  confirmação externa.
- Push direto em `main` costuma ser bloqueado pelo proxy do ambiente — o fluxo padrão é
  branch → PR (`mcp__github__create_pull_request`) → squash merge
  (`mcp__github__merge_pull_request`) → resync do `main` local.
- Nunca commitar `.env`, tokens ou `DATA_ENCRYPTION_KEY`. Variáveis de plataforma vs.
  variáveis por-tenant (WhatsApp, MP, frete) são configuradas em lugares diferentes —
  ver `.env.example` para o que é nível-servidor vs. painel do lojista.
