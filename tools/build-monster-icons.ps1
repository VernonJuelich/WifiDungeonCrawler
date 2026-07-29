param(
  [string]$Source = "$PSScriptRoot\..\Screenshots\PNG\4742c0d4-85b9-4ad2-8127-0d8d7382166e.png",
  [string]$Output = "$PSScriptRoot\..\nuc-server\public\icons"
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$names = @(
  @('slime', 'goblin', 'troll'),
  @('wyvern', 'drake', 'lich'),
  @('peasant', 'stalker', 'horror')
)
$sourceImage = [Drawing.Bitmap]::new((Resolve-Path $Source).Path)

try {
  $cellWidth = [math]::Floor($sourceImage.Width / 3)
  $cellHeight = [math]::Floor($sourceImage.Height / 3)
  New-Item -ItemType Directory -Path $Output -Force | Out-Null

  for ($row = 0; $row -lt 3; $row++) {
    for ($column = 0; $column -lt 3; $column++) {
      $name = $names[$row][$column]
      $left = $column * $cellWidth
      $top = $row * $cellHeight
      $width = if ($column -eq 2) { $sourceImage.Width - $left } else { $cellWidth }
      $height = if ($row -eq 2) { $sourceImage.Height - $top } else { $cellHeight }

      $minX = $width
      $minY = $height
      $maxX = -1
      $maxY = -1
      for ($y = 0; $y -lt $height; $y += 2) {
        for ($x = 0; $x -lt $width; $x += 2) {
          $pixel = $sourceImage.GetPixel($left + $x, $top + $y)
          if ($pixel.R -lt 235 -or $pixel.G -lt 235 -or $pixel.B -lt 235) {
            $minX = [math]::Min($minX, $x)
            $minY = [math]::Min($minY, $y)
            $maxX = [math]::Max($maxX, $x)
            $maxY = [math]::Max($maxY, $y)
          }
        }
      }
      if ($maxX -lt 0) { throw "No artwork found for $name." }

      $padding = 6
      $minX = [math]::Max(0, $minX - $padding)
      $minY = [math]::Max(0, $minY - $padding)
      $maxX = [math]::Min($width - 1, $maxX + $padding)
      $maxY = [math]::Min($height - 1, $maxY + $padding)
      $cropWidth = $maxX - $minX + 1
      $cropHeight = $maxY - $minY + 1

      $canvas = [Drawing.Bitmap]::new(256, 256, [Drawing.Imaging.PixelFormat]::Format32bppArgb)
      $graphics = [Drawing.Graphics]::FromImage($canvas)
      try {
        $graphics.Clear([Drawing.Color]::Transparent)
        $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $scale = [math]::Min(236 / $cropWidth, 236 / $cropHeight)
        $drawWidth = [math]::Round($cropWidth * $scale)
        $drawHeight = [math]::Round($cropHeight * $scale)
        $destX = [math]::Floor((256 - $drawWidth) / 2)
        $destY = [math]::Floor((256 - $drawHeight) / 2)
        $sourceRect = [Drawing.Rectangle]::new($left + $minX, $top + $minY, $cropWidth, $cropHeight)
        $destRect = [Drawing.Rectangle]::new($destX, $destY, $drawWidth, $drawHeight)
        $graphics.DrawImage($sourceImage, $destRect, $sourceRect, [Drawing.GraphicsUnit]::Pixel)
      } finally {
        $graphics.Dispose()
      }

      # Make the white sheet background transparent while keeping soft black edges.
      for ($y = 0; $y -lt 256; $y++) {
        for ($x = 0; $x -lt 256; $x++) {
          $pixel = $canvas.GetPixel($x, $y)
          $grey = [math]::Round(($pixel.R + $pixel.G + $pixel.B) / 3)
          if ($pixel.A -eq 0 -or $grey -ge 245) {
            $canvas.SetPixel($x, $y, [Drawing.Color]::Transparent)
          } else {
            $alpha = [math]::Max(0, [math]::Min(255, 255 - $grey))
            $canvas.SetPixel($x, $y, [Drawing.Color]::FromArgb($alpha, 0, 0, 0))
          }
        }
      }

      try {
        $path = Join-Path $Output "$name.png"
        $canvas.Save($path, [Drawing.Imaging.ImageFormat]::Png)
        Write-Host "$name`: $path"
      } finally {
        $canvas.Dispose()
      }
    }
  }
} finally {
  $sourceImage.Dispose()
}
