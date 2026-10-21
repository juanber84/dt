#!/usr/bin/env python3
"""Pantallas de arranque de la app instalada en iOS (public/splash) y sus <link> para index.html.

iOS no usa el manifest para esto: sin una imagen por tamaño de iPhone pinta un blanco al abrir.
Fondo del tema oscuro (--page) y el icono en el centro. Necesita Pillow.

    python3 apps/web/scripts/splash.py   # imprime los <link> a pegar en index.html
"""
from pathlib import Path

from PIL import Image, ImageDraw

WEB = Path(__file__).resolve().parent.parent
# (ancho CSS, alto CSS, densidad) de cada iPhone en vertical
DEVICES = [
    (440, 956, 3),  # 16/17 Pro Max
    (430, 932, 3),  # 14 Pro Max, 15/16 Plus, 15 Pro Max
    (420, 912, 3),  # Air
    (402, 874, 3),  # 16 Pro, 17, 17 Pro
    (393, 852, 3),  # 14 Pro, 15, 15 Pro, 16
    (428, 926, 3),  # 12/13 Pro Max, 14 Plus
    (390, 844, 3),  # 12, 13, 14, 16e
    (414, 896, 3),  # XS Max, 11 Pro Max
    (414, 896, 2),  # XR, 11
    (375, 812, 3),  # X, XS, 11 Pro, 12/13 mini
    (414, 736, 3),  # 6/7/8 Plus
    (375, 667, 2),  # SE 2/3, 6/7/8
]
BG = (15, 15, 14)  # --page del tema oscuro (#0f0f0e)
ICON_CSS_PX = 96

icon = Image.open(WEB / 'public/icons/icon-512.png').convert('RGBA')
(WEB / 'public/splash').mkdir(exist_ok=True)
for w, h, r in DEVICES:
    W, H = w * r, h * r
    size = ICON_CSS_PX * r
    img = icon.resize((size, size), Image.LANCZOS)
    # Esquinas redondeadas como el icono de la pantalla de inicio (dibujado a 4x para suavizar)
    mask = Image.new('L', (size * 4, size * 4), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, size * 4 - 1, size * 4 - 1), radius=round(size * 4 * 0.225), fill=255
    )
    img.putalpha(mask.resize((size, size), Image.LANCZOS))
    out = Image.new('RGB', (W, H), BG)
    out.paste(img, ((W - size) // 2, (H - size) // 2), img)
    name = f'splash/{W}x{H}.png'
    out.save(WEB / 'public' / name, optimize=True)
    print(
        f'    <link rel="apple-touch-startup-image" media="(device-width: {w}px) and '
        f'(device-height: {h}px) and (-webkit-device-pixel-ratio: {r}) and '
        f'(orientation: portrait)" href="/{name}" />'
    )
