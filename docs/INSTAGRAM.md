# Fonte de leads: Instagram

Extrai leads de **perfis comerciais** no Instagram — no mesmo espírito do
Google Maps (API oficial + dados públicos), mas via **Instagram Graph API**.
Foco em quem tem **WhatsApp/telefone público**, que é o que o robô dispara.

> **Por que não "raspar seguidores"?** O Instagram não tem API que liste os
> seguidores de outra conta; fazer isso exige logar e raspar, o que viola os
> Termos e derruba a conta. Além disso, seguidor é um @usuário, não um
> telefone — o robô ficaria sem número para disparar. Por isso esta fonte
> mira **perfis de empresa com contato público**, não seguidores.

## O que ela faz

Dois modos (escolhidos no painel, na fonte **📸 Instagram**):

- **Por hashtag/nicho** — pega publicações recentes de uma hashtag e minera
  telefone/WhatsApp direto das **legendas** (muita loja escreve "pedidos no
  WhatsApp 11 9…" no post).
- **Por perfis (@)** — você cola uma lista de @perfis comerciais e o robô lê a
  **bio + site** de cada um (via *Business Discovery*), extraindo o contato.

O resultado entra na mesma tabela dos leads do Google, então exportar,
selecionar e **disparar na nuvem (Pi)** funciona igual.

## Configuração (uma vez)

Precisa de um app na Meta e uma conta **Instagram Comercial/Criador** ligada a
uma Página do Facebook. Depois, defina no `.env.local` (raiz do painel):

```
IG_ACCESS_TOKEN=<token de acesso long-lived>
IG_BUSINESS_ID=<id da SUA conta IG comercial>
# opcional:
IG_GRAPH_VERSION=v21.0
```

Passo a passo para obter:

1. Em <https://developers.facebook.com>, crie um **App** (tipo "Business").
2. Ligue sua conta **Instagram Comercial** a uma **Página do Facebook**
   (Instagram › Configurações › Conta profissional › conectar Página).
3. No app, adicione o produto **Instagram Graph API** e conceda as permissões:
   `instagram_basic`, `pages_show_list`, `pages_read_engagement`,
   `instagram_manage_insights`.
4. Gere um **token de acesso** e troque por um **long-lived** (60 dias);
   renove antes de expirar.
5. Descubra o `IG_BUSINESS_ID` (o id da sua conta IG):
   `GET /me/accounts` → pega a Página → `GET /{page-id}?fields=instagram_business_account`.

## Limites que valem saber (da própria API da Meta)

- **Hashtag**: você pode consultar até **30 hashtags únicas a cada 7 dias** por
  conta; a API devolve **posts recentes**, não todos.
- **Business Discovery**: só funciona para contas **públicas comerciais/criador**
  (perfis pessoais ou privados não retornam). Devolve bio, site, nome e nº de
  seguidores — o telefone só aparece se estiver **escrito na bio/site**.
- **Sem lista de seguidores**: a API não expõe seguidores de terceiros (de
  propósito). Este recurso não tenta contornar isso.

## Uso no painel

1. No formulário de busca, clique em **📸 Instagram**.
2. Escolha **Por hashtag/nicho** ou **Por perfis (@)** e preencha.
3. **Buscar** → só entram na lista os que têm telefone/WhatsApp público.
4. Selecione e use **Disparar na nuvem (Pi)** normalmente.

> Continua valendo o cuidado anti-ban do WhatsApp: cota, aquecimento e
> intervalos. Lead de perfil comercial com contato público é bem mais
> defensável (LGPD) que mensagem fria para pessoa física.
