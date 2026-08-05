"""
生成历史占位头像图片（male-1~4.png / female-1~4.png）。

真实素材现由角色化 PNG 管理；运行本脚本会覆盖兼容别名，
仅允许在明确传入 --force-placeholders 时用于开发回退。
"""
import math
import os
import sys
from PIL import Image, ImageDraw

SIZE = 240
OUT_DIRS = [
    os.path.join(os.path.dirname(__file__), "..", "miniprogram", "images", "avatars"),
    os.path.join(os.path.dirname(__file__), "..", "cloud-run-remotion", "public", "avatars"),
]

# 男生：偏冷色调；女生：偏暖/柔色调
MALE_COLORS = ["#5B8DEF", "#4FB0AE", "#7C6FE0", "#2FB6D9"]
FEMALE_COLORS = ["#F27FA5", "#FFB067", "#B77CE0", "#F2637B"]


def draw_person(draw, cx, cy, r, color="#FFFFFF", alpha=235):
    # 头部
    head_r = r * 0.32
    head_cy = cy - r * 0.28
    fill = color + format(alpha, "02x") if len(color) == 7 else color
    draw.ellipse(
        [cx - head_r, head_cy - head_r, cx + head_r, head_cy + head_r],
        fill=fill,
    )
    # 身体（半圆/梯形肩部）
    body_top = cy + r * 0.05
    body_w = r * 0.72
    body_h = r * 0.62
    draw.pieslice(
        [cx - body_w, body_top - body_h, cx + body_w, body_top + body_h],
        180,
        360,
        fill=fill,
    )


def make_avatar(color_hex, out_path):
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    cx, cy, r = SIZE / 2, SIZE / 2, SIZE / 2

    # 背景圆形渐变感（简单双色叠加）
    base = tuple(int(color_hex[i : i + 2], 16) for i in (1, 3, 5))
    draw.ellipse([0, 0, SIZE, SIZE], fill=base + (255,))

    # 内部再叠一个稍浅的圆做层次感
    lighter = tuple(min(255, c + 25) for c in base)
    draw.ellipse(
        [SIZE * 0.06, SIZE * 0.06, SIZE * 0.94, SIZE * 0.94],
        fill=None,
        outline=lighter + (120,),
        width=6,
    )

    draw_person(draw, cx, cy, r, color="#FFFFFF", alpha=235)

    img.save(out_path, "PNG")


def main():
    for out_dir in OUT_DIRS:
        os.makedirs(out_dir, exist_ok=True)
        for i, color in enumerate(MALE_COLORS, start=1):
            make_avatar(color, os.path.join(out_dir, f"male-{i}.png"))
        for i, color in enumerate(FEMALE_COLORS, start=1):
            make_avatar(color, os.path.join(out_dir, f"female-{i}.png"))
        print(f"生成完成: {os.path.abspath(out_dir)}")


if __name__ == "__main__":
    main()
