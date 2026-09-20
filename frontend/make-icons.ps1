# Generate PWA icons for lgu-attendance: a token-accent gradient tile with a
# white landmark (bank) glyph. Run with: powershell -ExecutionPolicy Bypass -File make-icons.ps1
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$OutDir = Join-Path $PSScriptRoot 'public'
New-Item -ItemType Directory -Path $OutDir -Force | Out-Null

$Top = [System.Drawing.Color]::FromArgb(255, 0x2f, 0x6f, 0xed)
$Bottom = [System.Drawing.Color]::FromArgb(255, 0x1d, 0x4e, 0xd8)
$White = [System.Drawing.Color]::FromArgb(255, 0xff, 0xff, 0xff)

# Landmark glyph drawn on a 100x100 unit grid (roof, frieze, columns, base).
# scale <= 1 shrinks content into the center (maskable safe zone is 80%).
function Draw-Landmark([double]$scale, [double]$dx, [double]$dy) {
  $g.ScaleTransform($scale, $scale)
  $g.TranslateTransform($dx, $dy)

  $roof = @(
    (New-Object System.Drawing.Point([int](18*$gScale), [int](38*$gScale))),
    (New-Object System.Drawing.Point([int](50*$gScale), [int](12*$gScale))),
    (New-Object System.Drawing.Point([int](82*$gScale), [int](38*$gScale)))
  )
  $g.FillPolygon($WhiteBrush, $roof)

  $g.FillRectangle($WhiteBrush, [int](14*$gScale), [int](42*$gScale), [int](72*$gScale), [int](6*$gScale))
  foreach ($cx in 30, 50, 70) {
    $g.FillRectangle($WhiteBrush, [int](($cx-4)*$gScale), [int](48*$gScale), [int](8*$gScale), [int](28*$gScale))
  }
  $g.FillRectangle($WhiteBrush, [int](14*$gScale), [int](78*$gScale), [int](72*$gScale), [int](6*$gScale))

  $g.ResetTransform()
}

function New-Icon([string]$name, [int]$size, [double]$contentScale) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias

  $rect = New-Object System.Drawing.Rectangle(0, 0, $size, $size)
  $bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, $Top, $Bottom, 90)
  $g.FillRectangle($bg, $rect)
  $bg.Dispose()

  $script:gScale = $size / 100.0
  $WhiteBrush = New-Object System.Drawing.SolidBrush($White)
  $script:g = $g
  Draw-Landmark $contentScale (($size / 2) - (50 * $contentScale * $gScale)) (($size / 2) - (45 * $contentScale * $gScale))
  $WhiteBrush.Dispose()

  $g.Dispose()
  $path = Join-Path $OutDir $name
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Output "wrote $path"
}

New-Icon 'icon-512.png' 512 0.9
New-Icon 'icon-192.png' 192 0.9
New-Icon 'icon-maskable-512.png' 512 0.55
New-Icon 'apple-touch-icon.png' 180 0.9