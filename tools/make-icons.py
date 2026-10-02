"""Draws the app icons into ../icons. Run: python3 tools/make-icons.py (needs Pillow)."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parent.parent / "icons"
FONT = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"
BG = (17, 20, 24)
FG = (255, 255, 255)
ACCENT = (6, 83, 182)


def draw(size: int) -> Image.Image:
    s = 1024  # draw large, then shrink for smooth edges
    img = Image.new("RGB", (s, s), BG)
    d = ImageDraw.Draw(img)

    # "Z4" centered a little above middle
    font = ImageFont.truetype(FONT, 420)
    box = d.textbbox((0, 0), "Z4", font=font)
    w, h = box[2] - box[0], box[3] - box[1]
    d.text(((s - w) / 2 - box[0], 330 - h / 2 - box[1]), "Z4", font=font, fill=FG)

    # Checkered strip (autocross), kept inside the safe zone iOS/Android won't crop
    cols, cell = 10, 56
    x0 = (s - cols * cell) / 2
    y0 = 610
    for row in range(2):
        for col in range(cols):
            fill = FG if (row + col) % 2 == 0 else BG
            x, y = x0 + col * cell, y0 + row * cell
            d.rectangle([x, y, x + cell - 1, y + cell - 1], fill=fill)
    d.rectangle([x0, y0 + 2 * cell + 24, x0 + cols * cell - 1, y0 + 2 * cell + 44], fill=ACCENT)

    return img.resize((size, size), Image.LANCZOS)


OUT.mkdir(exist_ok=True)
for name, size in [("icon-192.png", 192), ("icon-512.png", 512), ("apple-touch-icon.png", 180)]:
    draw(size).save(OUT / name, optimize=True)
    print("wrote", OUT / name)
