# Controle central Render → Raspberry Pi

O Render é a fonte oficial de campanhas e estado. O Raspberry inicia uma conexão HTTPS de saída, busca trabalhos, mantém uma cópia operacional temporária e devolve heartbeat/resultados. Não abra a porta 8787 no roteador.

## 1. Criar o segredo

Gere uma vez:

```bash
openssl rand -hex 32
```

O valor não é uma senha para digitar no app. É uma chave técnica entre as duas máquinas.

## 2. Render (serviço Zapien)

Adicione a variável secreta:

```
ROBO_CONTROL_TOKEN=<valor-gerado>
```

## 3. Painel do Robo Comercial

Configure:

```
CONTROL_PLANE_URL=https://zapien.app
CONTROL_PLANE_TOKEN=<mesmo-valor>
```

## 4. Raspberry Pi — worker/.env

Configure:

```
CONTROL_PLANE_URL=https://zapien.app
CONTROL_PLANE_TOKEN=<mesmo-valor>
WORKER_ID=pi-casa
CONTROL_POLL_SEC=10
WORKER_DRY_RUN=true
```

Reinicie o worker. Durante a migração, `WORKER_DRY_RUN=true` sincroniza e valida campanhas sem enviar mensagens.

## 5. Teste seguro

1. Confirme no painel que o worker aparece online.
2. Crie uma campanha interna com um contato de teste.
3. Confirme que o trabalho muda de `queued` para `done`.
4. Confirme que a campanha apareceu no SQLite do Pi e nenhuma mensagem saiu.
5. Só depois altere `WORKER_DRY_RUN=false` e reinicie.

## Garantias

- jobs têm chave de idempotência;
- reservas expiram após 2 minutos e voltam à fila;
- somente o worker que reservou pode concluir;
- o Pi não precisa receber conexões externas;
- o modo teste é o padrão;
- o SQLite do Pi é operacional, enquanto a fila oficial fica no Render.
