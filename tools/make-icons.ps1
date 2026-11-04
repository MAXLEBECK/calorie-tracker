# Generates the app icons (run once: powershell -File tools\make-icons.ps1)
Add-Type -AssemblyName System.Drawing
$out = Join-Path $PSScriptRoot '..\icons'
New-Item -ItemType Directory -Force $out | Out-Null

foreach ($size in 180, 192, 512) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.Clear([System.Drawing.Color]::FromArgb(15, 17, 21))

  # four progress bars, echoing the app's home screen
  $colors = @(
    [System.Drawing.Color]::FromArgb(34, 197, 94),
    [System.Drawing.Color]::FromArgb(96, 165, 250),
    [System.Drawing.Color]::FromArgb(250, 204, 21),
    [System.Drawing.Color]::FromArgb(248, 113, 113)
  )
  $fills = @(0.85, 0.65, 0.5, 0.75)
  $pad = $size * 0.2
  $w = $size - 2 * $pad
  $h = $size * 0.085
  $gap = ($size - 2 * $pad - 4 * $h) / 3
  $track = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(38, 42, 50))
  for ($i = 0; $i -lt 4; $i++) {
    $y = $pad + $i * ($h + $gap)
    foreach ($pair in @(@($track, $w), @((New-Object System.Drawing.SolidBrush $colors[$i]), ($w * $fills[$i])))) {
      $path = New-Object System.Drawing.Drawing2D.GraphicsPath
      $bw = [float]$pair[1]; $r = [float]$h
      $path.AddArc([float]$pad, [float]$y, $r, $r, 90, 180)
      $path.AddArc([float]($pad + $bw - $r), [float]$y, $r, $r, 270, 180)
      $path.CloseFigure()
      $g.FillPath($pair[0], $path)
    }
  }
  $g.Dispose()
  $bmp.Save((Join-Path $out "icon-$size.png"), [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}
"Icons written to $out"
