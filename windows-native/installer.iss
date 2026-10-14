#define AppVersion "1.0.0"
[Setup]
AppId={{0A51BA25-7371-4784-96A7-D3B7353F45E5}
AppName=Solaris
AppVersion={#AppVersion}
AppPublisher=Solaris project owner
DefaultDirName={localappdata}\Programs\Solaris
DefaultGroupName=Solaris
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\dist\windows
OutputBaseFilename=Solaris-Windows-1.0-Setup
Compression=lzma2
SolidCompression=yes
UninstallDisplayIcon={app}\SolarisNativeHost.exe
CloseApplications=yes
SetupMutex=SolarisInstaller
[Files]
Source: "..\dist\native\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\dist\MicrosoftEdgeWebview2Setup.exe"; DestDir: "{tmp}"; Flags: deleteafterinstall
[Icons]
Name: "{group}\Solaris"; Filename: "{app}\SolarisNativeHost.exe"
Name: "{userdesktop}\Solaris"; Filename: "{app}\SolarisNativeHost.exe"
[Run]
Filename: "{tmp}\MicrosoftEdgeWebview2Setup.exe"; Parameters: "/silent /install"; StatusMsg: "WebView2 설치 확인 중..."; Flags: waituntilterminated
Filename: "{app}\SolarisNativeHost.exe"; Description: "Solaris 실행"; Flags: nowait postinstall skipifsilent
