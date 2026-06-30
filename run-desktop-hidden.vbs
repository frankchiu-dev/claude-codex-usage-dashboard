Dim fso, sh, folder, exePath, scriptPath
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
folder = fso.GetParentFolderName(WScript.ScriptFullName)
scriptPath = fso.BuildPath(folder, "desktop\main.js")
exePath = fso.BuildPath(folder, "node_modules\electron\dist\electron.exe")

sh.CurrentDirectory = folder
sh.Environment("PROCESS")("DASHBOARD_HOST") = "127.0.0.1"
sh.Run """" & exePath & """" & " """ & scriptPath & """", 0, False
