param(
  [string]$DonutSource = "$PSScriptRoot\..\Screenshots\PNG\d696d0ba-983d-48a1-b690-ddc8f327e75d.png",
  [string]$LootSource = "$PSScriptRoot\..\Screenshots\PNG\cedb429d-a6c4-4b7f-8c84-2b151a1a3d79.png",
  [string]$AssetRoot = "$PSScriptRoot\..\pi-agent\assets"
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

function Export-MonoFrame {
  param(
    [Drawing.Bitmap]$Source,
    [Drawing.Rectangle]$Cell,
    [string]$Destination
  )

  $minX = $Cell.Width
  $minY = $Cell.Height
  $maxX = -1
  $maxY = -1
  for ($y = 0; $y -lt $Cell.Height; $y += 2) {
    for ($x = 0; $x -lt $Cell.Width; $x += 2) {
      $pixel = $Source.GetPixel($Cell.X + $x, $Cell.Y + $y)
      if ($pixel.R -lt 225 -or $pixel.G -lt 225 -or $pixel.B -lt 225) {
        $minX = [math]::Min($minX, $x)
        $minY = [math]::Min($minY, $y)
        $maxX = [math]::Max($maxX, $x)
        $maxY = [math]::Max($maxY, $y)
      }
    }
  }
  if ($maxX -lt 0) { throw "No artwork found for $Destination" }

  $padding = 4
  $minX = [math]::Max(0, $minX - $padding)
  $minY = [math]::Max(0, $minY - $padding)
  $maxX = [math]::Min($Cell.Width - 1, $maxX + $padding)
  $maxY = [math]::Min($Cell.Height - 1, $maxY + $padding)
  $cropWidth = $maxX - $minX + 1
  $cropHeight = $maxY - $minY + 1

  $canvas = [Drawing.Bitmap]::new(105, 82)
  $graphics = [Drawing.Graphics]::FromImage($canvas)
  try {
    $graphics.Clear([Drawing.Color]::White)
    $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
    $scale = [math]::Min(101 / $cropWidth, 78 / $cropHeight)
    $drawWidth = [math]::Max(1, [math]::Round($cropWidth * $scale))
    $drawHeight = [math]::Max(1, [math]::Round($cropHeight * $scale))
    $destX = [math]::Floor((105 - $drawWidth) / 2)
    $destY = [math]::Floor((82 - $drawHeight) / 2)
    $sourceRect = [Drawing.Rectangle]::new(
      $Cell.X + $minX, $Cell.Y + $minY, $cropWidth, $cropHeight
    )
    $destRect = [Drawing.Rectangle]::new($destX, $destY, $drawWidth, $drawHeight)
    $graphics.DrawImage($Source, $destRect, $sourceRect, [Drawing.GraphicsUnit]::Pixel)
  } finally {
    $graphics.Dispose()
  }

  $mono = [Drawing.Bitmap]::new(105, 82, [Drawing.Imaging.PixelFormat]::Format1bppIndexed)
  $rect = [Drawing.Rectangle]::new(0, 0, 105, 82)
  $data = $mono.LockBits($rect, [Drawing.Imaging.ImageLockMode]::WriteOnly, $mono.PixelFormat)
  try {
    $bytes = [byte[]]::new($data.Stride * 82)
    [Array]::Fill($bytes, [byte]255)
    for ($y = 0; $y -lt 82; $y++) {
      for ($x = 0; $x -lt 105; $x++) {
        if ($canvas.GetPixel($x, $y).R -lt 150) {
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
    New-Item -ItemType Directory -Path (Split-Path $Destination) -Force | Out-Null
    $mono.Save($Destination, [Drawing.Imaging.ImageFormat]::Bmp)
    Write-Host $Destination
  } finally {
    $mono.Dispose()
  }
}

$donut = [Drawing.Bitmap]::new((Resolve-Path $DonutSource).Path)
try {
  $donutCells = @{
    idle  = [Drawing.Rectangle]::new(28, 30, 648, 505)
    run   = [Drawing.Rectangle]::new(735, 30, 648, 505)
    play  = [Drawing.Rectangle]::new(28, 595, 648, 490)
    sleep = [Drawing.Rectangle]::new(735, 595, 648, 490)
  }
  foreach ($name in $donutCells.Keys) {
    Export-MonoFrame $donut $donutCells[$name] (Join-Path $AssetRoot "donut\$name\frame-01.bmp")
  }
} finally {
  $donut.Dispose()
}

$loot = [Drawing.Bitmap]::new((Resolve-Path $LootSource).Path)
try {
  $lootNames = @(
    @('gold', 'bag', 'gem', 'key'),
    @('weapon', 'shield', 'helmet', 'armor'),
    @('potion', 'healing', 'scroll', 'ring'),
    @('boots', 'belt', 'pouch', 'book')
  )
  $xBounds = @(@(38, 328), @(378, 680), @(722, 1022), @(1063, 1364))
  $yBounds = @(@(143, 302), @(391, 548), @(640, 797), @(888, 1045))
  for ($row = 0; $row -lt 4; $row++) {
    for ($column = 0; $column -lt 4; $column++) {
      $x = $xBounds[$column][0]
      $y = $yBounds[$row][0]
      $cell = [Drawing.Rectangle]::new(
        $x, $y,
        $xBounds[$column][1] - $x,
        $yBounds[$row][1] - $y
      )
      $name = $lootNames[$row][$column]
      Export-MonoFrame $loot $cell (Join-Path $AssetRoot "loot\$name\frame-01.bmp")
    }
  }
} finally {
  $loot.Dispose()
}
