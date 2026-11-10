param([string]$Path = 'C:\Users\Admin\Downloads\_EDUNEXUS_MANUSCRIPT (1).docx')
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::OpenRead($Path)
try {
  $reader = [System.IO.StreamReader]::new($archive.GetEntry('word/document.xml').Open())
  try { [xml]$document = $reader.ReadToEnd() } finally { $reader.Dispose() }
  $ns = [System.Xml.XmlNamespaceManager]::new($document.NameTable)
  $ns.AddNamespace('w', 'http://schemas.openxmlformats.org/wordprocessingml/2006/main')
  $paragraphs = $document.SelectNodes('//w:body//w:p', $ns)
  $lines = foreach ($paragraph in $paragraphs) {
    $value = ($paragraph.SelectNodes('.//w:t', $ns) | ForEach-Object { $_.InnerText }) -join ''
    if ($value.Trim()) { $value }
  }
  New-Item -ItemType Directory -Path '.local' -Force | Out-Null
  $lines | Set-Content -LiteralPath '.local/manuscript.txt' -Encoding UTF8
  $archive.Entries | Where-Object { $_.FullName -like 'word/media/*' } | Select-Object FullName,Length
  Write-Output ('Extracted paragraphs: ' + $lines.Count)
  Get-Content -LiteralPath '.local/manuscript.txt'
} finally { $archive.Dispose() }
