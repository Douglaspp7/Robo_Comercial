#Requires AutoHotkey v2.0
; =============================================================================
;  Robô Comercial - Disparo WhatsApp (Opção D: macro de software)
;  Para Windows + AutoHotkey v2  (https://www.autohotkey.com)
; =============================================================================
;
;  COMO FUNCIONA (ciclo automático):
;    1) Envia F2  -> o app abre a aba do WhatsApp Web já preenchida
;    2) Espera o WhatsApp Web carregar
;    3) Envia ENTER -> dispara a mensagem
;    4) Envia Ctrl+W -> fecha a aba do WhatsApp e volta para o app
;    5) Espera um intervalo ALEATÓRIO (anti-spam) e repete
;
;  PRÉ-REQUISITOS:
;    - WhatsApp Web já logado no navegador.
;    - No app, abra "Disparar WhatsApp", marque "Modo macro" e clique
;      em "Iniciar disparo".
;    - Deixe a ABA DO APP em foco no navegador antes de ligar o macro.
;
;  CONTROLES:
;    F8  -> liga/desliga o disparo automático
;    Esc -> PARADA DE EMERGÊNCIA (para tudo na hora)
;
;  AJUSTE OS TEMPOS ABAIXO conforme a sua máquina/conexão.
; =============================================================================

; ---- Configurações (em milissegundos) --------------------------------------
minDelay   := 30000   ; intervalo mínimo entre disparos (30s)
maxDelay   := 90000   ; intervalo máximo entre disparos (90s)
loadWait   := 8000    ; tempo para o WhatsApp Web abrir e carregar o chat
sendWait   := 1500    ; espera após o Enter (confirmar envio)
afterClose := 1000    ; espera após fechar a aba (voltar ao app)
; ----------------------------------------------------------------------------

running := false

F8:: {
    global running
    running := !running
    if running {
        Notify("Disparo LIGADO - foque a aba do app")
        SetTimer(Cycle, -1000)   ; primeiro ciclo em ~1s
    } else {
        SetTimer(Cycle, 0)       ; cancela o agendamento
        Notify("Disparo DESLIGADO")
    }
}

Esc:: {
    global running
    running := false
    SetTimer(Cycle, 0)
    Notify("PARADO (emergência)")
}

Cycle() {
    global running, minDelay, maxDelay, loadWait, sendWait, afterClose
    if !running
        return

    ; 1) dispara o app -> abre a aba do WhatsApp
    Send("{F2}")

    ; 2) espera carregar
    if !WaitOrStop(loadWait)
        return

    ; 3) envia a mensagem
    Send("{Enter}")
    if !WaitOrStop(sendWait)
        return

    ; 4) fecha a aba do WhatsApp e volta para o app
    Send("^w")
    if !WaitOrStop(afterClose)
        return

    ; 5) cadência aleatória (humanizada) antes do próximo
    d := Random(minDelay, maxDelay)
    Notify("Próximo em " Round(d / 1000) "s")
    SetTimer(Cycle, -d)
}

; Espera em pequenos passos, abortando na hora se o usuário desligar (F8/Esc).
WaitOrStop(ms) {
    global running
    elapsed := 0
    while (elapsed < ms) {
        if !running
            return false
        Sleep(100)
        elapsed += 100
    }
    return running
}

Notify(text) {
    ToolTip(text)
    SetTimer(() => ToolTip(), -2000)
}
