# Write-Image-Lists-Per-Folder.ps1
# Creates An Output Folder, Then Writes One .Txt Per Folder
# Each Folder's .Txt Includes Images In That Folder AND All Of Its Subfolders

$Root = Get-Location

# Output Folder Name (Created In Root)
$OutDir = Join-Path $Root "_Image_Lists"
New-Item -ItemType Directory -Path $OutDir -Force | Out-Null

# Image Extensions To Include
$ImageExtensions = @(
  ".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp", ".tif", ".tiff", ".heic", ".heif", ".svg"
)

function Get-SafeFileName([string]$Text) {
  $Invalid = [System.IO.Path]::GetInvalidFileNameChars()
  foreach ($Ch in $Invalid) { $Text = $Text.Replace($Ch, "_") }
  if ([string]::IsNullOrWhiteSpace($Text)) { return "Root" }
  return $Text
}

# Get All Folders Including Root
$AllFolders = @($Root.Path) + (
  Get-ChildItem -Path $Root -Recurse -Directory -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty FullName
)

foreach ($Folder in $AllFolders) {

  # Relative Name For Output File
  $Rel = $Folder.Substring($Root.Path.Length).TrimStart("\","/") 
  if ([string]::IsNullOrWhiteSpace($Rel)) { $Rel = "Root" }

  $SafeRel = Get-SafeFileName($Rel.Replace("\","__").Replace("/","__"))
  $OutFile = Join-Path $OutDir ($SafeRel + ".txt")

  # Images Under This Folder (Including Subfolders)
  $Images = Get-ChildItem -Path $Folder -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object { $ImageExtensions -contains $_.Extension.ToLower() } |
    Sort-Object DirectoryName, Name

  # Build Lines
  $Lines = New-Object System.Collections.Generic.List[string]
  $Lines.Add(("Root: " + $Root.Path))
  $Lines.Add(("MainFolder: " + $Folder))
  $Lines.Add(("RelativeFolder: " + $Rel))
  $Lines.Add(("TotalImagesUnderMainFolder: " + $Images.Count))
  $Lines.Add("")

  if ($Images.Count -eq 0) {
    $Lines.Add("No Images Found Under This Folder (Including Subfolders).")
  } else {
    # Group By Actual Containing Folder, But Keep Everything In This One File
    $Groups = $Images | Group-Object DirectoryName | Sort-Object Name
    foreach ($G in $Groups) {
      $Lines.Add(("Folder: " + $G.Name))
      foreach ($F in ($G.Group | Sort-Object Name)) {
        $Lines.Add(("  - " + $F.Name))
      }
      $Lines.Add("")
    }
  }

  # Write File
  $Lines | Out-File -FilePath $OutFile -Encoding UTF8
}

Write-Host "Done."
Write-Host ("Output Folder: " + $OutDir)
Write-Host ("Files Created: " + ($AllFolders.Count))
