$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$lunaExtension = [IO.Path]::GetFullPath($PSScriptRoot)
$lunaManifest = Get-Content -LiteralPath (Join-Path $lunaExtension 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ($lunaManifest.version -notmatch '^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$') {
    throw 'package.json must contain a valid package version'
}
foreach ($key in @('name', 'publisher', 'displayName', 'description')) {
    if (-not ($lunaManifest.$key -is [string]) -or -not $lunaManifest.$key) { throw "Missing package.json field: $key" }
}
if (-not $lunaManifest.engines.vscode) { throw 'Missing engines.vscode in package.json' }
& node (Join-Path $lunaExtension 'sync-runtime.cjs')
if ($LASTEXITCODE -ne 0) { throw 'Runtime sync failed' }

$lunaFiles = @('package.json','extension.cjs','language-configuration.json','README.md',
    'lib\diagnostics.mjs','lib\luna.mjs','lib\profile.mjs','lib\language.mjs','syntaxes\luna.tmLanguage.json','assets\icon\ln_icon.png')
foreach ($name in $lunaFiles) {
    if (-not (Test-Path -LiteralPath (Join-Path $lunaExtension $name) -PathType Leaf)) { throw "Missing package file: $name" }
}
$lunaBuild = Join-Path $lunaExtension 'build'
[IO.Directory]::CreateDirectory($lunaBuild) | Out-Null
$lunaOutput = Join-Path $lunaBuild ($lunaManifest.name + '-' + $lunaManifest.version + '.vsix')
if ($lunaManifest.name -notmatch '^[a-z0-9][a-z0-9-]*$') { throw 'Invalid extension package name' }
$lunaTemporary = Join-Path $lunaBuild ([IO.Path]::GetRandomFileName() + '.zip')
function ConvertTo-LunaXml($text) { [Security.SecurityElement]::Escape([string]$text) }
$lunaId = ConvertTo-LunaXml $lunaManifest.name
$lunaVersion = ConvertTo-LunaXml $lunaManifest.version
$lunaPublisher = ConvertTo-LunaXml $lunaManifest.publisher
$lunaDisplay = ConvertTo-LunaXml $lunaManifest.displayName
$lunaDescription = ConvertTo-LunaXml $lunaManifest.description
$lunaEngine = ConvertTo-LunaXml $lunaManifest.engines.vscode
$lunaKinds = ConvertTo-LunaXml ($lunaManifest.extensionKind -join ',')
$lunaCategories = ConvertTo-LunaXml ($lunaManifest.categories -join ',')
$lunaArchive = $null
function Add-LunaText($name, $text) {
    $entry = $lunaArchive.CreateEntry($name)
    $writer = New-Object IO.StreamWriter($entry.Open(), (New-Object Text.UTF8Encoding($false)))
    try { $writer.Write($text) } finally { $writer.Dispose() }
}
try {
    $lunaArchive = [IO.Compression.ZipFile]::Open($lunaTemporary, [IO.Compression.ZipArchiveMode]::Create)
    $lunaVsixManifest = @"
<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011">
  <Metadata>
    <Identity Language="en-US" Id="$lunaId" Version="$lunaVersion" Publisher="$lunaPublisher"/>
    <DisplayName>$lunaDisplay</DisplayName>
    <Description xml:space="preserve">$lunaDescription</Description>
    <Tags>Luna,Lua</Tags><Categories>$lunaCategories</Categories><GalleryFlags>Public</GalleryFlags>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="$lunaEngine"/>
      <Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="$lunaKinds"/>
      <Property Id="Microsoft.VisualStudio.Code.ExecutesCode" Value="true"/>
    </Properties>
  </Metadata>
  <Installation><InstallationTarget Id="Microsoft.VisualStudio.Code"/></Installation>
  <Dependencies/>
  <Assets><Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true"/>
    <Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true"/></Assets>
</PackageManifest>
"@
    Add-LunaText 'extension.vsixmanifest' $lunaVsixManifest
    Add-LunaText '[Content_Types].xml' '<?xml version="1.0" encoding="utf-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="json" ContentType="application/json"/><Default Extension="vsixmanifest" ContentType="text/xml"/><Default Extension="cjs" ContentType="application/javascript"/><Default Extension="mjs" ContentType="application/javascript"/><Default Extension="md" ContentType="text/markdown"/><Default Extension="png" ContentType="image/png"/></Types>'
    foreach ($name in $lunaFiles) {
        $source = Join-Path $lunaExtension $name
        $entryName = 'extension/' + $name.Replace('\','/')
        [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($lunaArchive, $source, $entryName) | Out-Null
    }
    $lunaArchive.Dispose()
    $lunaArchive = $null
    # Replace the old package only after the new archive is complete.
    Move-Item -LiteralPath $lunaTemporary -Destination $lunaOutput -Force
} finally {
    if ($null -ne $lunaArchive) { $lunaArchive.Dispose() }
    if (Test-Path -LiteralPath $lunaTemporary) { Remove-Item -LiteralPath $lunaTemporary }
}
Write-Output $lunaOutput
