#Requires AutoHotkey v2.0
; =============================================================================
;  Robô Comercial - Disparo WhatsApp (Opção D AVANÇADA: detecção de imagem)
;  Para Windows + AutoHotkey v2  (https://www.autohotkey.com)
; =============================================================================
;
;  DIFERENÇA para a versão simples:
;    Em vez de esperar um tempo FIXO, este script ESPERA o botão de enviar
;    do WhatsApp Web APARECER na tela (ImageSearch) antes de mandar o Enter.
;    O botão de enviar só surge quando há texto no campo -> sinal perfeito de
;    que o chat carregou e a mensagem está pronta. Muito mais confiável.
;
;  PRÉ-REQUISITO EXTRA: uma imagem de referência do botão de enviar.
;    Veja "COMO CAPTURAR A IMAGEM" no tools/README.md.
;    Salve como:  tools\img\send_button.png
;
;  CONTROLES:
;    F8  -> liga/desliga
;    Esc -> PARADA DE EMERGÊNCIA
; =============================================================================

; ---- Configurações ---------------------------------------------------------
imgSend     := A_ScriptDir "\img\send_button.png"  ; imagem do botão de enviar
sendMode    := "enter" ; "enter" = aperta Enter (recomendado) | "click" = clica no aviãozinho
findTimeout := 20000   ; tempo máx. esperando o botão aparecer (ms)
variation   := 50      ; tolerância de cor do ImageSearch (0-255; maior = mais flexível)
stabilize   := 400     ; estabilização após detectar o botão (ms)
sendWait    := 1200    ; espera após enviar (ms)
afterClose  := 1000    ; espera após fechar a aba (ms)
minDelay    := 30000   ; intervalo mínimo entre disparos (ms)
maxDelay    := 90000   ; intervalo máximo entre disparos (ms)
beepOnSend  := true    ; bipe curto a cada envio bem-sucedido
beepOnFail  := true    ; bipe de alerta quando NÃO detecta o botão
; ----------------------------------------------------------------------------

running := false

F8:: {
    global running, imgSend
    if !FileExist(imgSend) {
        MsgBox("Imagem não encontrada:`n" imgSend "`n`nCapture o botão de enviar e salve nesse caminho. Veja o README.", "Robô Comercial", "Iconx")
        return
    }
    running := !running
    if running {
        Notify("Disparo LIGADO - foque a aba do app")
        SetTimer(Cycle, -1000)
    } else {
        SetTimer(Cycle, 0)
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
    global running, sendWait, afterClose, sendMode, imgSend, beepOnSend, beepOnFail
    if !running
        return

    ; 1) dispara o app -> abre a aba do WhatsApp já preenchida
    Send("{F2}")

    ; 2) espera o BOTÃO DE ENVIAR aparecer (chat carregado + texto pronto)
    pos := WaitForImage()
    if !pos {
        ; Não carregou a tempo: não envia nada, fecha e segue para o próximo.
        Notify("Botão enviar não detectado - pulando este")
        if beepOnFail {
            SoundBeep(400, 250)
            SoundBeep(300, 250)
        }
        Send("^w")
        WaitOrStop(afterClose)
        ScheduleNext()
        return
    }

    ; 3) pequena estabilização e envia
    if !WaitOrStop(stabilize)
        return
    if (sendMode = "click") {
        ; clica no CENTRO do aviãozinho (canto + metade do tamanho da imagem)
        size := GetPngSize(imgSend)
        MouseMove(pos.x + size.w // 2, pos.y + size.h // 2, 2)
        Click()
    } else {
        Send("{Enter}")
    }
    if beepOnSend
        SoundBeep(900, 90)
    if !WaitOrStop(sendWait)
        return

    ; 4) fecha a aba do WhatsApp e volta para o app
    Send("^w")
    if !WaitOrStop(afterClose)
        return

    ; 5) cadência aleatória antes do próximo
    ScheduleNext()
}

; Procura a imagem do botão de enviar até achar ou estourar o timeout.
; Retorna {x, y} (canto da imagem) ou false.
WaitForImage() {
    global running, imgSend, findTimeout, variation
    endTime := A_TickCount + findTimeout
    while (A_TickCount < endTime) {
        if !running
            return false
        try {
            if ImageSearch(&fx, &fy, 0, 0, A_ScreenWidth, A_ScreenHeight, "*" variation " " imgSend)
                return { x: fx, y: fy }
        } catch as e {
            Notify("Erro ImageSearch: " e.Message)
            return false
        }
        Sleep(200)
    }
    return false
}

ScheduleNext() {
    global running, minDelay, maxDelay
    if !running
        return
    d := Random(minDelay, maxDelay)
    Notify("Próximo em " Round(d / 1000) "s")
    SetTimer(Cycle, -d)
}

; Espera em passos curtos, abortando na hora se desligar (F8/Esc).
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

; Lê largura/altura de um PNG direto do cabeçalho IHDR (offset 16/20, big-endian).
GetPngSize(path) {
    f := FileOpen(path, "r")
    f.Pos := 16
    w := ReadBE32(f)
    h := ReadBE32(f)
    f.Close()
    return { w: w, h: h }
}

ReadBE32(f) {
    b1 := f.ReadUChar(), b2 := f.ReadUChar(), b3 := f.ReadUChar(), b4 := f.ReadUChar()
    return (b1 << 24) | (b2 << 16) | (b3 << 8) | b4
}
