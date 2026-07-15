# Plano: redundância do número de WhatsApp da plataforma

Status: **estratégia de pools escolhida e em andamento no lado manual** (compra/registro
de números no Meta, ~R$35/número, pagamento único). **O lado de código (seção
"O que falta implementar") ainda não foi feito** — revisitar quando o primeiro
segundo número estiver pronto pra receber tenants.

## Problema

O Zapien roteia por um único número WhatsApp compartilhado por todos os tenants
(`WA_SERVER_PHONE` / `config.whatsapp.phoneNumberId`). Isso é um ponto único de
falha: uma denúncia em massa de concorrente, ou o próprio WhatsApp sinalizando
spam (risco que aumentou com a feature de campanhas segmentadas — PR #137),
pode bloquear o número e derrubar o atendimento de **todos** os lojistas ao
mesmo tempo, não só de um.

## Opções avaliadas e descartadas por ora

- **Meta Embedded Signup** (cada lojista conecta o próprio número oficial via
  Cloud API, sob o "Tech Provider" do Zapien) — solução definitiva/oficial,
  mas exige aprovação da Meta como Tech Provider (processo de dias/semanas) e
  integração do fluxo de Facebook Login for Business. Guardado como aposta de
  longo prazo — pode começar a aplicação em paralelo sem compromisso.
  **Achado**: já existe scaffolding parcial em `src/meta.js`
  (`exchangeCodeForToken` — troca o `code` do `FB.login` por access token;
  `registerPhoneNumber` — registra o número na Cloud API após o signup) e em
  `config.meta` (`META_APP_ID`/`META_APP_SECRET`/`META_CONFIG_ID`,
  `embeddedSignupEnabled`). Nenhuma rota em `api.js` nem UI usam isso ainda,
  mas é um adiantamento real caso decidam seguir por aqui — **mantido no
  código** (ao contrário de Evolution/Z-API abaixo), por já se alinhar ao
  caminho escolhido.
- **Evolution API** (self-host, protocolo não-oficial tipo Baileys) — já
  tentado antes, descartado por instabilidade de conexão (problema estrutural
  do Baileys, não específico da Evolution — a Meta quebra o protocolo
  periodicamente). O código órfão (`src/evolution.js`, `src/evo-poll.js`,
  `src/evo-state.js`, coluna `tenants.evolution_instance`) foi **removido**
  do repositório — sem uso e sem caminho futuro definido; se for reavaliado,
  recuperar do histórico do git.
- **Z-API** (serviço pago de terceiro, mesmo conceito) — descartado por custo
  mensal por instância. O código órfão (`src/zapi.js`, colunas
  `tenants.zapi_instance_id`/`zapi_token`/`zapi_client_token`) também foi
  **removido** pelo mesmo motivo.
- **whatsapp-web.js / Puppeteer** (1 Chrome headless por número conectado) —
  mais estável contra quebra de protocolo, mas custo de infraestrutura escala
  mal (cada número = um processo de navegador rodando 24h, ~150-300MB RAM
  parado). Não avaliado como prioridade dado o público-alvo (muitos lojistas
  pequenos).

## Plano escolhido: pools manuais de números

O dono da plataforma cria um novo número no Meta Business Manager (pode ser
até uma BM diferente, ~R$35/número, pagamento único) e move novos tenants
para esse "pool". Se um número for banido, só aquele pool é afetado, não a
base inteira.

### Tamanho do pool — não é sobre contar lojistas, é sobre volume

A Meta não pensa em "quantos clientes por número" — ela dá um **tier de
mensagens iniciadas pela empresa por 24h** por número (começa em ~250/dia,
sobe pra 1K/10K/100K conforme a reputação/"quality rating" do número se
mantém boa). Ou seja, o risco não escala linear com número de lojistas —
escala com quanto eles disparam mensagem proativamente (follow-up, recompra
automática, e principalmente **campanhas segmentadas**, PR #137, que são o
maior gatilho de volume/reclamação).

Regra prática adotada:
- **~5 lojistas por número** como ponto de partida (não 10) — ajustar depois
  com dado real de volume observado, não é regra fixa em pedra.
- **Separar por uso de campanha**: pool de lojistas que usam a feature de
  campanhas fica menor (3-5), pool de lojistas só com atendimento passivo
  pode ir mais perto de 10.
- **Monitorar o "Quality Rating"** (verde/amarelo/vermelho) de cada número no
  WhatsApp Manager. Se um número ficar amarelo, migrar lojistas dele
  proativamente pra outro pool **antes** de virar vermelho/banido — não
  esperar o banimento acontecer pra agir.

### Aquisição de números via eSIM

eSIM funciona bem pra isso — o registro na Cloud API só exige receber um
código por SMS/ligação **uma única vez**; depois disso o número vive nos
servidores da Meta e não precisa do eSIM continuar ativo em nenhum aparelho.
Mais leve que juntar vários chips físicos/aparelhos. Três cuidados antes de
comprar/registrar vários números adiantado:

1. **Custo recorrente escondido** — confirmar com o provedor do eSIM se o
   valor por número é realmente pagamento único, ou se existe mensalidade só
   pra manter o número válido enquanto fica parado sem uso.
2. **Reciclagem por inatividade** — provedores de número virtual costumam
   reciclar números sem uso após um tempo (pra revender). Um número já
   registrado no Meta mas ainda não distribuído a nenhum tenant pode ser
   perdido se o provedor reciclar antes de ser usado — confirmar a política
   de inatividade do provedor específico.
3. **Sem "esquentar" reputação adiantado** — o quality rating/tier de
   mensagens da Meta não melhora só pelo número existir há mais tempo parado;
   se constrói com uso real. Registrar cedo só economiza a burocracia de
   registrar depois, não dá vantagem de reputação.

Cuidado extra: **evitar registrar muitos números de uma vez na mesma Business
Manager** em curto espaço de tempo — isso pode, por si só, acionar revisão
automática de fraude da Meta na conta. Melhor espaçar os registros ao longo
de semanas, ou distribuir entre BMs diferentes.

### Achado importante: parte da infraestrutura já existe, esquecida

Ao investigar o schema, `tenants` já tem colunas `wa_phone_number_id` e
`wa_token` **por tenant** (cifradas, `wa_phone_number_id` com índice único), e
existe `tenantQueries.byPhoneNumberId` pronta. As funções de envio em
`src/whatsapp.js` (`sendText`, `sendImage`, `sendDocument`, `sendVideo`,
`sendTemplate`) já recebem o tenant como parâmetro (`_tenant`, hoje ignorado
com underscore) — ou seja, alguém já desenhou "número por tenant" antes e
nunca terminou de ligar. Mesmo padrão do que aconteceu com Evolution/Z-API.

### O que falta implementar quando chegar a hora

1. **`src/whatsapp.js`**: usar `tenant.wa_phone_number_id`/`tenant.wa_token`
   quando presentes, com fallback pro número compartilhado global
   (`config.whatsapp.phoneNumberId`/`token`) quando ausentes. Mudança pequena
   e cirúrgica — só trocar o `_tenant` ignorado por uso real.
2. **Atribuição de tenant → pool**: como é decisão manual do dono da
   plataforma (não self-service do lojista), basta um campo no painel admin
   pra setar `wa_phone_number_id`/`wa_token` de um tenant específico.
3. **Número de exibição por pool**: `wa_phone_number_id` é o ID técnico da
   API, diferente do número real usado no link `wa.me/`. As rotas `/a:code`,
   `/c:slug` e `/api/whatsapp/link` (hoje usam `process.env.WA_SERVER_PHONE`
   global) precisam guardar/servir o número de exibição correto por pool, não
   só o ID técnico.
4. **Roteamento de entrada (webhook) — provavelmente não precisa mudar nada**:
   hoje o Zapien descobre de qual tenant é a mensagem pelo código
   (attendance_code/route_code/slug) embutido na primeira mensagem do
   cliente, não pelo número que recebeu — então múltiplos números devem
   funcionar sem alteração no roteamento, desde que os códigos continuem
   únicos na plataforma inteira (já são).
5. **Múltiplas Business Managers**: não é problema técnico — cada
   App/BM tem seu próprio token de verificação de webhook, mas esse valor é
   escolhido por quem configura (não precisa ser único por App) e todas podem
   apontar pra mesma URL de webhook do Zapien.

## Gatilho para revisitar

- Volume de tenants crescendo a ponto de um bloqueio afetar muita gente de
  uma vez.
- Sinal real de denúncia/bloqueio (mesmo que temporário) no número
  compartilhado atual.
- Decisão de perseguir Embedded Signup em paralelo, se a aprovação como Tech
  Provider já tiver sido iniciada e estiver perto de sair.
