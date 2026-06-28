# Disparo automático de WhatsApp (Opção D — macro de software)

Automação **100% por software** para o disparo do WhatsApp, sem hardware.
Usa o app (Modo macro) + um script **AutoHotkey** no Windows.

## ⚠️ Antes de tudo

- Automatizar envios viola o espírito dos Termos do WhatsApp e **volume alto
  derruba número** mesmo com clique "real". Mantenha a **cota diária** e os
  **intervalos aleatórios**. Use com responsabilidade e em números próprios.

## Pré-requisitos

1. **Windows** com [AutoHotkey **v2**](https://www.autohotkey.com) instalado.
2. **WhatsApp Web já logado** no navegador (Chrome recomendado).
3. O app do Robô Comercial aberto na busca, com contatos selecionados.

## Passo a passo

1. No app, clique em **"Disparar WhatsApp"**.
2. Preencha a mensagem padrão e a **URL do app** (puxa o logo no preview).
3. Marque a opção **"Modo macro"**.
4. Ajuste a **cota diária** (ex.: 40) e clique em **"Iniciar disparo"**.
5. Dê **dois cliques** em `whatsapp-autoclicker.ahk` para rodar o script.
6. **Foque a aba do app** no navegador e pressione **F8** para ligar.
   - O ciclo roda sozinho: abre o zap (F2) → envia (Enter) → fecha (Ctrl+W)
     → espera intervalo aleatório → repete.
7. **F8** novamente desliga. **Esc** é a parada de emergência.

## Como o macro funciona

```
F2     -> o app abre a aba do WhatsApp Web já preenchida
(espera o WhatsApp carregar)
Enter  -> envia a mensagem
Ctrl+W -> fecha a aba e volta para o app
(espera intervalo aleatório 30-90s)
... repete
```

## Ajustes (edite o topo do .ahk)

| Variável     | O que é                                   | Padrão  |
|--------------|-------------------------------------------|---------|
| `minDelay`   | intervalo mínimo entre disparos (ms)      | 30000   |
| `maxDelay`   | intervalo máximo entre disparos (ms)      | 90000   |
| `loadWait`   | tempo p/ o WhatsApp Web abrir/carregar    | 8000    |
| `sendWait`   | espera após o Enter                        | 1500    |
| `afterClose` | espera após fechar a aba                    | 1000    |

> Se mensagens saírem **vazias** ou no chat errado, **aumente `loadWait`**
> (o WhatsApp Web demorou mais que o esperado para carregar). A primeira
> mensagem costuma ser a mais lenta.

## Dicas

- Não mexa no mouse/teclado enquanto o ciclo roda (ele usa o teclado).
- Comece com **poucos contatos** para calibrar os tempos.
- A **cota diária** do app continua valendo: ao atingir, o app para de
  enviar mesmo que o macro pressione F2.
