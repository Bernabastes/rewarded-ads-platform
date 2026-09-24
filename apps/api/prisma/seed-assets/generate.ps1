<#
.SYNOPSIS
  Regenerates the tiny placeholder ad creatives used by the demo seed (apps/api/prisma/seed.ts).
  Uses a one-off ffmpeg container so nothing needs to be installed on the host. All clips are synthetic
  gradients (no third-party media), H.264 baseline / yuv420p so they play in browsers, Expo (expo-video)
  and iOS Safari. Total size stays well under 2 MB.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File apps/api/prisma/seed-assets/generate.ps1
#>
$ErrorActionPreference = 'Stop'
$out = (Resolve-Path $PSScriptRoot).Path
$image = 'jrottenberg/ffmpeg:7.1-alpine'

# name, seconds, three gradient colours (brand-ish palettes), animation speed
$clips = @(
  @{ name = 'morning-roast';  seconds = 15; c = @('0x7C2D12', '0xF59E0B', '0xFDE68A'); speed = 0.03 },
  @{ name = 'origin-story';   seconds = 15; c = @('0x14532D', '0x4ADE80', '0xFEF3C7'); speed = 0.02 },
  @{ name = 'vertical-cut';   seconds = 15; c = @('0x431407', '0xEA580C', '0xFFEDD5'); speed = 0.04 },
  @{ name = 'loyalty-card';   seconds = 15; c = @('0x0F172A', '0x0EA5E9', '0xBAE6FD'); speed = 0.03 },
  @{ name = 'savings-goals';  seconds = 20; c = @('0x1E3A8A', '0x3B82F6', '0xDBEAFE'); speed = 0.025 },
  @{ name = 'send-money';     seconds = 15; c = @('0x312E81', '0x8B5CF6', '0xEDE9FE'); speed = 0.035 },
  @{ name = 'eid-promo';      seconds = 15; c = @('0x064E3B', '0x10B981', '0xFDE68A'); speed = 0.03 },
  @{ name = 'launch-film';    seconds = 30; c = @('0x0F4C81', '0xF97316', '0xFFF7ED'); speed = 0.02 }
)

foreach ($clip in $clips) {
  $src = "gradients=s=480x270:speed=$($clip.speed):duration=$($clip.seconds):rate=12:c0=$($clip.c[0]):c1=$($clip.c[1]):c2=$($clip.c[2])"
  Write-Host "generating $($clip.name).mp4 ($($clip.seconds)s)"
  docker run --rm -v "${out}:/out" $image -hide_banner -loglevel error -y -f lavfi -i $src `
    -c:v libx264 -profile:v baseline -level 3.0 -pix_fmt yuv420p -crf 34 -preset veryslow -g 48 `
    -movflags +faststart -an "/out/$($clip.name).mp4"
  docker run --rm -v "${out}:/out" $image -hide_banner -loglevel error -y -ss 2 -i "/out/$($clip.name).mp4" `
    -frames:v 1 -vf "scale=320:180" -compression_level 9 "/out/$($clip.name).png"
}

Get-ChildItem $out -Include *.mp4, *.png -Recurse | Select-Object Name, Length | Format-Table -AutoSize
"total bytes: $((Get-ChildItem $out -Include *.mp4, *.png -Recurse | Measure-Object Length -Sum).Sum)"
