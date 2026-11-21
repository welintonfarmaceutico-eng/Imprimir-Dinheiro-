// Modelo do programa "Jarvis PC" (PowerShell do Windows). O servidor troca os __MARCADORES__
// pela chave e pelos canais deste Jarvis na hora do download (veja computador.js).
// Atenção ao editar: o texto fica dentro de String.raw`...`, então não pode ter crase nem "${".
export const MODELO_PC = String.raw`# Jarvis PC: recebe ordens do seu Jarvis e executa neste computador.
# Só faz três coisas: abrir programa, abrir site e mexer no volume.
# Toda ordem precisa estar assinada com a sua chave; ordens falsas ou antigas são ignoradas.
$ErrorActionPreference = 'Stop'
$Chave = '__CHAVE__'
$Servidor = '__SERVIDOR__'
$TopicoComandos = '__TOPICO_COMANDOS__'
$TopicoRespostas = '__TOPICO_RESPOSTAS__'

$Pasta = Join-Path $env:APPDATA 'JarvisPC'
$Destino = Join-Path $Pasta 'jarvis-pc.ps1'
$Registro = Join-Path $Pasta 'registro.txt'
$PowerShellExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Registrar([string]$texto) {
  try {
    New-Item -ItemType Directory -Force -Path $Pasta | Out-Null
    if ((Test-Path $Registro) -and ((Get-Item $Registro).Length -gt 200KB)) { Remove-Item $Registro -Force }
    Add-Content -Path $Registro -Value ((Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '  ' + $texto) -Encoding UTF8
  } catch {}
}

function Avisar([string]$texto) {
  try { Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show($texto, 'Jarvis PC') | Out-Null } catch {}
}

# ---------- Instalação ----------
# Ao abrir o arquivo baixado: copia para a pasta do usuário, cria o atalho para iniciar com o Windows
# e começa a rodar escondido.
if ($PSCommandPath -and ($PSCommandPath -ne $Destino)) {
  New-Item -ItemType Directory -Force -Path $Pasta | Out-Null
  Copy-Item -Path $PSCommandPath -Destination $Destino -Force
  Unblock-File -Path $Destino -ErrorAction SilentlyContinue
  $argumentos = '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $Destino + '"'
  $inicializar = [Environment]::GetFolderPath('Startup')
  $atalho = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $inicializar 'Jarvis PC.lnk'))
  $atalho.TargetPath = $PowerShellExe
  $atalho.Arguments = $argumentos
  $atalho.WindowStyle = 7
  $atalho.Description = 'Jarvis PC'
  $atalho.Save()
  # Se uma versão antiga estiver rodando, encerra antes de iniciar a nova.
  Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like '*JarvisPC*' -and $_.ProcessId -ne $PID } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Process -FilePath $PowerShellExe -ArgumentList $argumentos -WindowStyle Hidden
  Avisar ('Jarvis PC instalado e conectado!' + [Environment]::NewLine + [Environment]::NewLine +
    'Ele inicia sozinho junto com o Windows. Agora é só pedir ao Jarvis, por exemplo: "abre o YouTube no PC".')
  exit
}

# Só uma cópia rodando por vez.
$criado = $false
$Trava = New-Object System.Threading.Mutex($true, 'Local\JarvisPC', [ref]$criado)
if (-not $criado) { exit }

# ---------- Ferramentas ----------
function Assinar([string]$texto) {
  $hmac = New-Object System.Security.Cryptography.HMACSHA256 -ArgumentList (,[Text.Encoding]::UTF8.GetBytes($Chave))
  $bytes = $hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes($texto))
  return (($bytes | ForEach-Object { $_.ToString('x2') }) -join '')
}

# Tira acentos e símbolos para comparar nomes ("Calculadora" = "calculadora").
function Simplificar([string]$s) {
  if (-not $s) { return '' }
  $n = $s.ToLowerInvariant().Normalize([Text.NormalizationForm]::FormD)
  $n = $n -replace '\p{Mn}', ''
  $n = $n -replace '[^a-z0-9 ]', ' '
  return ($n -replace '\s+', ' ').Trim()
}

$Conhecidos = @{
  'chrome' = 'chrome'; 'google chrome' = 'chrome'; 'edge' = 'msedge'; 'microsoft edge' = 'msedge'; 'navegador' = 'msedge'
  'bloco de notas' = 'notepad'; 'notepad' = 'notepad'; 'calculadora' = 'calc'
  'explorador' = 'explorer'; 'explorador de arquivos' = 'explorer'; 'arquivos' = 'explorer'; 'meus arquivos' = 'explorer'
  'paint' = 'mspaint'; 'configuracoes' = 'ms-settings:'; 'spotify' = 'spotify:'; 'whatsapp' = 'whatsapp:'
  'word' = 'winword'; 'excel' = 'excel'; 'powerpoint' = 'powerpnt'; 'outlook' = 'outlook'
  'vscode' = 'code'; 'vs code' = 'code'; 'visual studio code' = 'code'; 'terminal' = 'wt'; 'prompt de comando' = 'cmd'
  'gerenciador de tarefas' = 'taskmgr'; 'camera' = 'microsoft.windows.camera:'; 'fotos' = 'ms-photos:'; 'loja' = 'ms-windows-store:'
}

function AbrirPrograma([string]$nome) {
  $alvo = Simplificar $nome
  if (-not $alvo) { throw 'Diga o nome do programa.' }
  # 1) Procura nos atalhos do menu Iniciar e da Área de Trabalho (pega os programas instalados).
  $pastas = @(
    (Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu\Programs'),
    (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'),
    [Environment]::GetFolderPath('Desktop'),
    (Join-Path $env:PUBLIC 'Desktop')
  )
  $atalhos = foreach ($p in $pastas) {
    if ($p -and (Test-Path $p)) { Get-ChildItem -Path $p -Recurse -Include '*.lnk', '*.url' -ErrorAction SilentlyContinue }
  }
  $candidatos = $atalhos |
    Where-Object { $n = Simplificar $_.BaseName; ($n -like ('*' + $alvo + '*')) -and ($n -notmatch 'uninstall|desinstal') } |
    Sort-Object @{ Expression = { if ((Simplificar $_.BaseName) -eq $alvo) { 0 } else { 1 } } }, @{ Expression = { $_.BaseName.Length } }
  $escolhido = $candidatos | Select-Object -First 1
  if ($escolhido) {
    Start-Process -FilePath $escolhido.FullName
    return ('Abri o ' + $escolhido.BaseName + '.')
  }
  # 2) Programas do próprio Windows (calculadora, bloco de notas...).
  if ($Conhecidos.ContainsKey($alvo)) {
    Start-Process -FilePath $Conhecidos[$alvo]
    return ('Abri o ' + $nome + '.')
  }
  throw ('Não achei o programa "' + $nome + '" neste computador.')
}

function AbrirSite([string]$endereco) {
  $e = $endereco.Trim()
  if ($e -notmatch '^[a-zA-Z][a-zA-Z0-9+.-]*://') { $e = 'https://' + $e }
  $uri = $null
  if (-not [Uri]::TryCreate($e, [UriKind]::Absolute, [ref]$uri)) { throw 'Endereço de site inválido.' }
  if ($uri.Scheme -ne 'https' -and $uri.Scheme -ne 'http') { throw 'Só abro endereços de sites (http ou https).' }
  Start-Process -FilePath $uri.AbsoluteUri
  return ('Abri ' + $uri.Host + ' no navegador.')
}

$Teclado = New-Object -ComObject WScript.Shell
function Teclar([int]$codigo, [int]$vezes) {
  for ($i = 0; $i -lt $vezes; $i++) { $Teclado.SendKeys([string][char]$codigo); Start-Sleep -Milliseconds 20 }
}

# Teclas de volume do Windows: 175 sobe 2%, 174 desce 2%, 173 liga/desliga o mudo.
function Volume([string]$pedido) {
  $p = Simplificar $pedido
  if ($p -match '^\d+$') {
    $n = [Math]::Max(0, [Math]::Min(100, [int]$p))
    Teclar 174 50
    Teclar 175 ([Math]::Round($n / 2))
    return ('Volume em ' + $n + '%.')
  }
  if ($p -match 'mudo|silenc|mute|desmut') { Teclar 173 1; return 'Pronto, alternei o mudo.' }
  if ($p -match 'max') { Teclar 175 50; return 'Volume no máximo.' }
  if ($p -match 'subi|aument|mais|alto') { Teclar 175 5; return 'Aumentei o volume.' }
  if ($p -match 'desc|diminu|baix|menos') { Teclar 174 5; return 'Diminuí o volume.' }
  throw 'Não entendi o pedido de volume.'
}

function Responder([string]$id, [bool]$ok, [string]$mensagem) {
  $okTexto = 'false'
  if ($ok) { $okTexto = 'true' }
  $corpo = @{ id = $id; ok = $ok; mensagem = $mensagem; sig = (Assinar ($id + '|' + $okTexto + '|' + $mensagem)) } | ConvertTo-Json -Compress
  Invoke-RestMethod -Method Post -Uri ($Servidor + '/' + $TopicoRespostas) -Body ([Text.Encoding]::UTF8.GetBytes($corpo)) -ContentType 'text/plain; charset=utf-8' | Out-Null
}

$Vistos = New-Object 'System.Collections.Generic.HashSet[string]'

function Processar([string]$texto) {
  try { $c = $texto | ConvertFrom-Json } catch { return }
  if (-not $c.id -or -not $c.sig) { return }
  if (-not $Vistos.Add([string]$c.id)) { return }
  $alvo = [string]$c.alvo
  $esperado = Assinar ([string]$c.id + '|' + [string]$c.acao + '|' + $alvo + '|' + [string]$c.ts)
  if ($c.sig -ne $esperado) { Registrar 'Ordem com assinatura inválida: ignorada.'; return }
  $agora = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
  if ([Math]::Abs($agora - [long]$c.ts) -gt 300) { Registrar 'Ordem antiga: ignorada.'; return }
  try {
    switch ([string]$c.acao) {
      'abrir_programa' { $msg = AbrirPrograma $alvo }
      'abrir_site' { $msg = AbrirSite $alvo }
      'volume' { $msg = Volume $alvo }
      'ping' { $msg = 'Jarvis PC conectado.' }
      default { throw 'Ação não permitida.' }
    }
    Registrar ([string]$c.acao + ' ' + $alvo + ' -> ' + $msg)
    Responder ([string]$c.id) $true $msg
  } catch {
    Registrar ('Erro em ' + [string]$c.acao + ': ' + $_.Exception.Message)
    try { Responder ([string]$c.id) $false $_.Exception.Message } catch {}
  }
}

# ---------- Fica ouvindo as ordens ----------
Add-Type -AssemblyName System.Net.Http
$Cliente = New-Object System.Net.Http.HttpClient
$Cliente.Timeout = [System.Threading.Timeout]::InfiniteTimeSpan
Registrar 'Jarvis PC iniciado.'
while ($true) {
  try {
    $fluxo = $Cliente.GetStreamAsync($Servidor + '/' + $TopicoComandos + '/json').GetAwaiter().GetResult()
    $leitor = New-Object System.IO.StreamReader($fluxo, [Text.Encoding]::UTF8)
    while ($true) {
      $linha = $leitor.ReadLine()
      if ($null -eq $linha) { break }
      if (-not $linha.Trim()) { continue }
      $evento = $linha | ConvertFrom-Json
      if ($evento.event -eq 'message') { Processar ([string]$evento.message) }
    }
  } catch {
    Registrar ('Conexão perdida, tentando de novo: ' + $_.Exception.Message)
  }
  Start-Sleep -Seconds 5
}
`;
