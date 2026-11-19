; Custom NSIS hook (runs when the installer starts).
; electron-builder already asks the user to close a running app before installing,
; so the only extra job here is stopping the bundled database if it was left running
; (e.g. after a crash), so its files can be replaced during an update.
!macro preInit
  nsExec::Exec '"$SYSDIR\taskkill.exe" /F /IM "smartshot-mongod.exe" /T'
  Pop $0
!macroend
