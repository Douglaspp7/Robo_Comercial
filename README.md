# Robo Comercial

Painel **privado** de prospecção do Zapien. Busca e organiza leads, cria
campanhas e controla um worker de WhatsApp dedicado. Quando um lead responde,
o worker encaminha a conversa para uma instância isolada do atendente Zapien.

## Componentes

- Raiz (`src/`): painel administrativo Next.js.
- `worker/`: filas, chips WhatsApp, cotas, agendamento e opt-out.
- `atendente/`: atendente Zapien isolado, com IA, CRM e handoff humano.

## Segurança do painel

Em Render ou internet pública, todas as páginas e APIs exigem uma sessão
administrativa. Copie `.env.example` para `.env.local` e configure:

```ini
PANEL_ADMIN_EMAIL=voce@exemplo.com
PANEL_ADMIN_PASSWORD=senha-com-6-ou-mais-caracteres
PANEL_SESSION_SECRET=<resultado de openssl rand -hex 32>
```

Sem essas três variáveis, o painel falha fechado e não permite usar as chaves
Google, Instagram, SMTP ou o worker. O login permite 5 tentativas a cada 15
minutos por IP e a sessão expira em 12 horas.

No Raspberry acessível somente pela rede de casa ou Tailscale, use
`PANEL_AUTH_DISABLED=1`. Não abra a porta 3000 no roteador nesse modo.

## Desenvolvimento

```bash
npm ci
cp .env.example .env.local
npm run dev
```

O painel abre em `http://localhost:3000`. Consulte `worker/README.md` e
`worker/deploy/IMPLANTACAO-PI.md` para instalar o fluxo completo.

## Produção

O `render.yaml` cria painel, worker e atendente. No serviço `robo-painel`,
preencha `PANEL_ADMIN_EMAIL` e `PANEL_ADMIN_PASSWORD`; o Blueprint gera
`PANEL_SESSION_SECRET`. O endpoint público `/health` do worker expõe apenas
estado agregado e nunca retorna telefone, QR ou código de pareamento.

> O worker usa Baileys, uma integração não oficial. Prospecção fria pode
> causar bloqueio do número e exige operação responsável, opt-out e observância
> à LGPD e aos termos aplicáveis.
