!macro preInit
  ; Try a graceful shutdown by invoking the installed exe with --shutdown
  ; Common locations to try: current $INSTDIR, LocalAppData Programs folder
  StrCpy $0 "$INSTDIR\\Smart Screenshot Search Engine.exe"
  IfFileExists $0 0 +3
    nsExec::ExecToLog '"$0" --shutdown'

  ; Try the per-user programs folder (default electron-builder install location)
  StrCpy $1 "$LOCALAPPDATA\\Programs\\Smart Screenshot Search Engine\\Smart Screenshot Search Engine.exe"
  IfFileExists $1 0 +3
    nsExec::ExecToLog '"$1" --shutdown'

  ; If the above didn't stop the app, give it up to 8 seconds to exit
  ; polling for running processes and then fallback to force kill.
  ; Poll 8 times with 1s sleep
  StrCpy $2 8
  loopCheck:
    nsExec::ExecToLog '"$SYSDIR\\cmd.exe" /C "tasklist /FI \"IMAGENAME eq Smart Screenshot Search Engine.exe\" | findstr /I \"Smart Screenshot Search Engine.exe\""'
    Pop $R0
    StrCmp $R0 "" doneCheck
    IntOp $2 $2 - 1
    IntCmp $2 0 forceKill loopSleep
    loopSleep:
      Sleep 1000
      Goto loopCheck
  forceKill:
    ; forcefully terminate common target processes to ensure files can be replaced
    nsExec::ExecToLog '"$SYSDIR\\taskkill.exe" /F /IM "Smart Screenshot Search Engine.exe" /T'
    nsExec::ExecToLog '"$SYSDIR\\taskkill.exe" /F /IM "electron.exe" /T'
    nsExec::ExecToLog '"$SYSDIR\\taskkill.exe" /F /IM "node.exe" /T'
  doneCheck:
    ; continue with install
!macroend
