!macro customInstall
  DetailPrint "正在安装记忆服务 Ollama，并下载记忆模型。这一步需要联网。"
  nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\install-ollama.ps1"'
  Pop $0
  ${If} $0 != 0
    MessageBox MB_OK|MB_ICONEXCLAMATION "Ollama 没有安装完成。Murasame 仍可使用，但记忆不会按意思被想起来。可以稍后重新运行安装程序。"
  ${EndIf}
  DetailPrint "正在安装中文朗读所需的 Python。"
  nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\install-python.ps1"'
  Pop $1
  ${If} $1 != 0
    MessageBox MB_OK|MB_ICONEXCLAMATION "中文朗读组件没有安装完成。文字对话仍可使用。可以稍后重新运行安装程序。"
  ${EndIf}
!macroend

!macro customUnInstall
  MessageBox MB_YESNO|MB_ICONQUESTION "要删除 Murasame 保存在这台电脑上的数据吗？$\n$\n包括对话、记忆和数据库密钥。删除后无法恢复。$\n选「否」会保留数据，下次安装可以继续用。" IDYES removeData IDNO keepData
  removeData:
    RMDir /r "$APPDATA\murasame-desktop"
  keepData:
!macroend
