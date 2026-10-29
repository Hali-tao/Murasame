!macro customInstall
  ; 记忆用的向量模型随安装包一起装，这里不需要联网准备任何东西。
  ; extraResources 的 to: resources 会落在 $INSTDIR\resources\resources 下。
  DetailPrint "正在准备中文朗读所需的 Python。"
  nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\resources\install-python.ps1"'
  Pop $0
  ${If} $0 == 2
    DetailPrint "现在连不上下载源，中文朗读组件没有安装。联网后重新运行一次安装程序即可，其他功能不受影响。"
  ${ElseIf} $0 != 0
    MessageBox MB_OK|MB_ICONEXCLAMATION "中文朗读组件没有安装完成。对话、记忆和桌宠都不受影响，只是不会出声。联网后重新运行安装程序可以再装一次。"
  ${EndIf}
!macroend

!macro customUnInstall
  ; electron-builder also calls this hook while replacing the old version.
  ; Only an explicit choice during an interactive uninstall may remove data.
  ${If} ${isUpdated}
    Goto keepData
  ${EndIf}
  ${If} ${Silent}
    Goto keepData
  ${EndIf}
  MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "要删除 Murasame 保存在这台电脑上的数据吗？$\n$\n包括对话、记忆和数据库密钥。删除后无法恢复。$\n选「否」会保留数据，下次安装可以继续用。" /SD IDNO IDYES removeData IDNO keepData
  Goto keepData
  removeData:
    RMDir /r "$APPDATA\murasame-desktop"
  keepData:
!macroend
