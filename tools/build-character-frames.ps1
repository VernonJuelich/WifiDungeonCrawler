param(
  [string]$Source = "$PSScriptRoot\..\Screenshots\PNG\carl-actions-clean.png",
  [string]$Output = "$PSScriptRoot\..\pi-agent\assets\characters"
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$actions = @(
  @('idle', 'walk', 'run', 'attack', 'critical-hit'),
  @('cast-spell', 'healing', 'take-damage', 'block', 'victory'),
  @('resting', 'reading', 'looting', 'shopping', 'level-up'),
  @('drink-coffee', 'talking', 'thinking', 'scared', 'dead')
)
$sourceImage = [Drawing.Bitmap]::new((Resolve-Path $Source).Path)

try {
  $cellWidth = [math]::Floor($sourceImage.Width / 5)
  $cellHeight = [math]::Floor($sourceImage.Height / 4)

  for ($column = 0; $column -lt 5; $column++) {
    for ($row = 0; $row -lt 4; $row++) {
      $action = $actions[$row][$column]
      $groupPath = Join-Path $Output $action
      New-Item -ItemType Directory -Path $groupPath -Force | Out-Null
      $left = $column * $cellWidth
      $top = $row * $cellHeight
      $width = if ($column -eq 4) { $sourceImage.Width - $left } else { $cellWidth }
      $height = if ($row -eq 3) { $sourceImage.Height - $top } else { $cellHeight }
      # Ignore a narrow overlap gutter where effects from adjacent poses can bleed.
      $leftTrim = 10
      $rightTrim = if ($action -eq 'scared') { 28 } else { 10 }
      $left += $leftTrim
      $width -= ($leftTrim + $rightTrim)

      # Find the non-white artwork inside this grid cell.
      $minX = $width
      $minY = $height
      $maxX = -1
      $maxY = -1
      for ($y = 0; $y -lt $height; $y += 2) {
        for ($x = 0; $x -lt $width; $x += 2) {
          $pixel = $sourceImage.GetPixel($left + $x, $top + $y)
          if ($pixel.R -lt 246 -or $pixel.G -lt 246 -or $pixel.B -lt 246) {
            $minX = [math]::Min($minX, $x)
            $minY = [math]::Min($minY, $y)
            $maxX = [math]::Max($maxX, $x)
            $maxY = [math]::Max($maxY, $y)
          }
        }
      }

      if ($maxX -lt 0) { throw "No artwork found for $action." }
      $padding = 4
      $minX = [math]::Max(0, $minX - $padding)
      $minY = [math]::Max(0, $minY - $padding)
      $maxX = [math]::Min($width - 1, $maxX + $padding)
      $maxY = [math]::Min($height - 1, $maxY + $padding)
      $cropWidth = $maxX - $minX + 1
      $cropHeight = $maxY - $minY + 1

      $canvas = [Drawing.Bitmap]::new(105, 80)
      $graphics = [Drawing.Graphics]::FromImage($canvas)
      try {
        $graphics.Clear([Drawing.Color]::White)
        $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
        $graphics.PixelOffsetMode = [Drawing.Drawing2D.PixelOffsetMode]::Half
        $scale = [math]::Min(101 / $cropWidth, 76 / $cropHeight)
        $drawWidth = [math]::Max(1, [math]::Round($cropWidth * $scale))
        $drawHeight = [math]::Max(1, [math]::Round($cropHeight * $scale))
        $destX = [math]::Floor((105 - $drawWidth) / 2)
        $destY = 80 - $drawHeight - 2
        $sourceRect = [Drawing.Rectangle]::new($left + $minX, $top + $minY, $cropWidth, $cropHeight)
        $destRect = [Drawing.Rectangle]::new($destX, $destY, $drawWidth, $drawHeight)
        $graphics.DrawImage($sourceImage, $destRect, $sourceRect, [Drawing.GraphicsUnit]::Pixel)
        if ($action -eq 'scared') {
          $graphics.FillRectangle([Drawing.Brushes]::White, 0, 0, 105, 8)
        }
      } finally {
        $graphics.Dispose()
      }

      # Ordered dithering gives the 1-bit e-ink panel useful mid-tone texture.
      $mono = [Drawing.Bitmap]::new(105, 80, [Drawing.Imaging.PixelFormat]::Format1bppIndexed)
      $rect = [Drawing.Rectangle]::new(0, 0, 105, 80)
      $data = $mono.LockBits($rect, [Drawing.Imaging.ImageLockMode]::WriteOnly, $mono.PixelFormat)
      try {
        $bytes = [byte[]]::new($data.Stride * 80)
        [Array]::Fill($bytes, [byte]255)
        $bayer = @(0,8,2,10, 12,4,14,6, 3,11,1,9, 15,7,13,5)
        for ($y = 0; $y -lt 80; $y++) {
          for ($x = 0; $x -lt 105; $x++) {
            $pixel = $canvas.GetPixel($x, $y)
            $grey = [math]::Round(0.299 * $pixel.R + 0.587 * $pixel.G + 0.114 * $pixel.B)
            $threshold = 104 + $bayer[(($y % 4) * 4) + ($x % 4)] * 7
            if ($grey -lt $threshold) {
              $index = $y * $data.Stride + [math]::Floor($x / 8)
              $bytes[$index] = $bytes[$index] -band (0xFF -bxor (0x80 -shr ($x % 8)))
            }
          }
        }
        [Runtime.InteropServices.Marshal]::Copy($bytes, 0, $data.Scan0, $bytes.Length)
      } finally {
        $mono.UnlockBits($data)
        $canvas.Dispose()
      }

      try {
        $filename = Join-Path $groupPath 'frame-01.bmp'
        $mono.Save($filename, [Drawing.Imaging.ImageFormat]::Bmp)
        Write-Host "$action`: $filename"
      } finally {
        $mono.Dispose()
      }
    }
  }
} finally {
  $sourceImage.Dispose()
}
