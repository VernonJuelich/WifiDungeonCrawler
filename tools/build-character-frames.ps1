param(
  [string]$Source = "$PSScriptRoot\..\Screenshots\PNG\carl-actions-grid.jpg",
  [string]$Output = "$PSScriptRoot\..\pi-agent\assets\characters"
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$actions = @(
  @('idle', 'walk', 'run', 'attack', 'critical-hit'),
  @('cast-spell', 'block', 'healing', 'take-damage', 'victory'),
  @('looting', 'level-up', 'resting', 'reading', 'drink-coffee'),
  @('shopping', 'talking', 'thinking', 'scared', 'dead')
)
$sourceImage = [Drawing.Bitmap]::new((Resolve-Path $Source).Path)

try {
  # Exact rule positions in the supplied 1280x1074 grid. The columns are
  # intentionally unequal, so equal-size slicing would clip or mix poses.
  $gridXByRow = @(
    @(13, 230, 467, 728, 983, 1260),
    @(14, 242, 467, 728, 983, 1260),
    @(14, 242, 467, 728, 983, 1260),
    @(14, 242, 467, 728, 983, 1260)
  )
  $gridY = @(12, 272, 535, 788, 1055)
  if ($sourceImage.Width -ne 1280 -or $sourceImage.Height -ne 1074) {
    throw "Expected the 1280x1074 Carl action grid; got $($sourceImage.Width)x$($sourceImage.Height)."
  }

  for ($column = 0; $column -lt 5; $column++) {
    for ($row = 0; $row -lt 4; $row++) {
      $action = $actions[$row][$column]
      $gridX = $gridXByRow[$row]
      $groupPath = Join-Path $Output $action
      New-Item -ItemType Directory -Path $groupPath -Force | Out-Null
      # Start below the heading and remain inside the cell rules.
      $left = $gridX[$column] + 3
      $top = $gridY[$row] + 45
      $width = $gridX[$column + 1] - $left - 3
      $height = $gridY[$row + 1] - $top - 3

      # Find the non-white artwork inside this grid cell.
      $minX = $width
      $minY = $height
      $maxX = -1
      $maxY = -1
      for ($y = 0; $y -lt $height; $y += 2) {
        for ($x = 0; $x -lt $width; $x += 2) {
          $pixel = $sourceImage.GetPixel($left + $x, $top + $y)
          if ($pixel.R -lt 220 -or $pixel.G -lt 220 -or $pixel.B -lt 220) {
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
