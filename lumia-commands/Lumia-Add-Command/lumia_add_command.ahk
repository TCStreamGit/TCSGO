#NoEnv
#SingleInstance Force
SetTitleMatchMode, 2
CoordMode, Pixel, Screen
CoordMode, Mouse, Screen
SetWorkingDir, %A_ScriptDir%

; =========================
; Config
; =========================
commandsRoot := "A:\Development\Version Control\Github\TCSGO\lumia-commands"

imgApply := "lumia_apply.png"
imgAliasesTab := "lumia_aliases.png"
imgAliasPlus := "add_alias_plus.png"

; Fixed screen coordinates (from Window Spy)
posAddCommandX := 1693
posAddCommandY := 304
posNameX := 616
posNameY := 441
posDescX := 666
posDescY := 508
posCodeTabX := 592
posCodeTabY := 360
posCodeAreaX := 669
posCodeAreaY := 662
posAliasesTabX := 1028
posAliasesTabY := 145
posApplyX := 1538
posApplyY := 983
posRefreshX := 1192
posRefreshY := 989

; Alias + still uses image search
aliasPlusOffsetX := 8
aliasPlusOffsetY := 8

; Debug logging
debugEnabled := true
debugLogPath := A_ScriptDir . "\\lumia_add_command.log"
if (debugEnabled)
    FileDelete, %debugLogPath%

; =========================
; Build Command List
; =========================
commands := []

Loop, Files, %commandsRoot%\*.js, R
{
    FileRead, content, %A_LoopFileFullPath%
    if (ErrorLevel)
        continue

    cmdName := ""
    if RegExMatch(content, "m)^\s*\*\s*Command Name:\s*(.+)$", m)
        cmdName := Trim(m1)
    else if RegExMatch(content, "m)^\s*\*\s*Command:\s*(.+)$", m)
        cmdName := Trim(m1)
    if (cmdName = "")
        continue

    cmdName := Trim(cmdName)
    if (cmdName = "")
        continue
    cmdNameUi := cmdName
    if (SubStr(cmdNameUi, 1, 1) = "!")
        cmdNameUi := SubStr(cmdNameUi, 2)

    desc := ""
    if RegExMatch(content, "m)^\s*\*\s*Description:\s*(.+)$", d)
        desc := Trim(d1)

    aliasesLine := ""
    if RegExMatch(content, "m)^\s*\*\s*Aliases:\s*(.+)$", a)
        aliasesLine := Trim(a1)

    aliases := []
    if (aliasesLine != "" && !RegExMatch(aliasesLine, "i)^none$"))
    {
        Loop, Parse, aliasesLine, `,
        {
            alias := Trim(A_LoopField, " `t`r`n")
            if (alias = "")
                continue
            aliasUi := alias
            if (aliasUi = "")
                continue
            aliasCompare := aliasUi
            if (SubStr(aliasCompare, 1, 1) = "!")
                aliasCompare := SubStr(aliasCompare, 2)
            aliasCompareLower := aliasCompare
            cmdNameCompare := cmdName
            if (SubStr(cmdNameCompare, 1, 1) = "!")
                cmdNameCompare := SubStr(cmdNameCompare, 2)
            cmdNameLower := cmdNameCompare
            StringLower, aliasCompareLower, aliasCompareLower
            StringLower, cmdNameLower, cmdNameLower
            if (aliasCompareLower = cmdNameLower)
                continue
            aliases.Push(aliasUi)
        }
    }

    if (debugEnabled)
        LogMsg("Found: " . cmdName . " | aliases=" . aliases.Length() . " | file=" . A_LoopFileFullPath)

    commands.Push({name: cmdNameUi, desc: desc, aliases: aliases, path: A_LoopFileFullPath})
}

if (commands.Length() = 0)
{
    MsgBox, 16, Lumia Add Command, No command files with headers were found.
    return
}

; =========================
; Main Loop
; =========================
for index, cmd in commands
{
    ; Add new command
    MouseClick, Left, posAddCommandX, posAddCommandY
    Sleep, 100

    ; Command name
    MouseClick, Left, posNameX, posNameY
    Sleep, 40
    Send, ^a
    ClipSet(cmd.name)
    Send, ^v
    Sleep, 120

    ; Description (relative to name field)
    if (cmd.desc != "")
    {
        MouseClick, Left, posDescX, posDescY
        Sleep, 80
        Send, ^a
        ClipSet(cmd.desc)
        Send, ^v
        Sleep, 120
    }

    ; Code tab + code paste
    MouseClick, Left, posCodeTabX, posCodeTabY
    Sleep, 120
    MouseClick, Left, posCodeAreaX, posCodeAreaY
    Sleep, 80
    FileRead, code, % cmd.path
    ClipSet(code)
    Send, ^a
    Send, ^v
    Sleep, 180
    MouseClick, Left, posCodeAreaX, posCodeAreaY
    Sleep, 40
    Loop, 18
    {
        Send, {WheelUp}
        Sleep, 20
    }
    Sleep, 80

    ; Aliases tab
    ClickAliasesTab()
    Sleep, 200
    for aIndex, alias in cmd.aliases
        AddAlias(alias)

    ; Apply
    MouseClick, Left, posApplyX, posApplyY
    Sleep, 1000
    MouseClick, Left, posRefreshX, posRefreshY
    Sleep, 300
}

return

; =========================
; Helpers
; =========================
WaitImage(imagePath, ByRef outX, ByRef outY, timeoutMs := 30000)
{
    start := A_TickCount
    Loop
    {
        ImageSearch, x, y, 0, 0, A_ScreenWidth, A_ScreenHeight, *30 %imagePath%
        if (!ErrorLevel)
        {
            outX := x
            outY := y
            return true
        }
        if ((A_TickCount - start) > timeoutMs)
            return false
        Sleep, 300
    }
}

ClipSet(text)
{
    Clipboard := ""
    Sleep, 40
    Clipboard := text
    ClipWait, 2
    Sleep, 40
}

AddAlias(alias)
{
    global imgAliasPlus, aliasPlusOffsetX, aliasPlusOffsetY
    if !WaitImage(imgAliasPlus, x, y, 5000)
    {
        ClickAliasesTab()
        if !WaitImage(imgAliasPlus, x, y, 5000)
        {
            LogMsg("Alias plus not found. Skipping alias: " . alias)
            return
        }
    }

    MouseMove, x + aliasPlusOffsetX, y + aliasPlusOffsetY, 0
    Click
    Sleep, 80

    ClipSet(alias)
    Send, ^v
    Sleep, 60

    Send, {Enter}
    Sleep, 300
}

ClickAliasesTab()
{
    global imgAliasesTab, posAliasesTabX, posAliasesTabY
    if WaitImage(imgAliasesTab, x, y, 1500)
    {
        MouseMove, x + 6, y + 6, 0
        Click
        return
    }
    MouseClick, Left, posAliasesTabX, posAliasesTabY
}

LogMsg(message)
{
    global debugEnabled, debugLogPath
    if (!debugEnabled)
        return
    FormatTime, ts,, yyyy-MM-dd HH:mm:ss
    FileAppend, %ts%`t%message%`r`n, %debugLogPath%
}
