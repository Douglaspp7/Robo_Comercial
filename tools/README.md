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

---

# Versão avançada: detecção de imagem (mais confiável)

Arquivo: **`whatsapp-autoclicker-imagesearch.ahk`**

Em vez de esperar um tempo **fixo** para o WhatsApp carregar, esta versão
**espera o botão de enviar aparecer na tela** antes de disparar.
Como esse botão (aviãozinho) só surge quando há texto no campo, ele é um
sinal perfeito de que o chat carregou e a mensagem está pronta — elimina
mensagens vazias ou enviadas cedo demais.

### Como ele envia: Enter ou clique?

O `ImageSearch` serve de **"sensor de pronto"** — ele varre os pixels e acha
o aviãozinho. O que acontece depois depende de `sendMode`:

- **`"enter"` (padrão):** detecta o botão (= chat pronto) e aperta **`Enter`**.
  O mouse **não se move**. Mais simples e robusto.
- **`"click"`:** detecta o botão, **move o mouse até o centro do ícone e
  clica**. O script calcula o centro lendo o tamanho do `send_button.png`.

Recomendado deixar em `"enter"`. Use `"click"` só se o Enter não enviar no
seu caso (ex.: layout/atalho diferente).

## Como capturar a imagem do botão de enviar

> A captura precisa ser feita na **mesma tela, resolução, zoom do navegador
> e tema (claro/escuro)** que você usará no disparo. Se mudar qualquer um
> desses, recapture.

1. Abra um chat no WhatsApp Web e **digite qualquer texto** — o ícone de
   enviar (aviãozinho de papel) aparece no canto inferior direito.
2. Pressione **`Win + Shift + S`** (Ferramenta de Captura) e recorte
   **bem justo** apenas o ícone de enviar.
3. Cole no Paint e salve como **`send_button.png`** dentro de `tools/img/`.

## Uso

1. Faça os mesmos passos da versão simples (app em **Modo macro**,
   **Iniciar disparo**).
2. Dê dois cliques em `whatsapp-autoclicker-imagesearch.ahk`.
3. Foque a aba do app e pressione **F8**.

## Ajustes (topo do .ahk)

| Variável      | O que é                                             | Padrão |
|---------------|-----------------------------------------------------|--------|
| `sendMode`    | `"enter"` aperta Enter · `"click"` clica no aviãozinho | enter |
| `findTimeout` | tempo máx. esperando o botão aparecer (ms)          | 20000  |
| `variation`   | tolerância de cor (0–255). Aumente se não detectar  | 50     |
| `stabilize`   | estabilização após detectar o botão (ms)            | 400    |
| `sendWait`    | espera após o Enter (ms)                             | 1200   |
| `afterClose`  | espera após fechar a aba (ms)                        | 1000   |
| `minDelay` / `maxDelay` | intervalo aleatório entre disparos (ms)   | 30000 / 90000 |
| `beepOnSend`  | bipe curto a cada envio bem-sucedido                | true   |
| `beepOnFail`  | bipe de alerta quando NÃO detecta o botão           | true   |

> **Bipes:** o script toca um bipe agudo a cada envio e um bipe grave duplo
> quando a detecção falha — assim você opera de ouvido, sem olhar a tela.
> O próprio app também emite um som ao **terminar a campanha** e ao **atingir
> a cota diária**.

## Comportamento de segurança

- Se o botão **não for detectado** dentro de `findTimeout`, o script **não
  envia nada**: fecha a aba e segue para o próximo contato (evita disparo
  errado). Você verá o aviso "Botão enviar não detectado - pulando este".
- Se a imagem `send_button.png` não existir, o script avisa e não inicia.

## Resolução de problemas

- **Nunca detecta o botão:** confira o caminho `tools/img/send_button.png`,
  recapture na resolução/tema atuais e **aumente `variation`** (ex.: 80).
- **Detecta no lugar errado:** recorte a imagem mais justa/única (inclua só
  o ícone, sem fundo repetitivo).
- **Tela com escala (DPI) diferente:** capture com a mesma escala do Windows
  usada no disparo.
