"""Generate FieldCast README badges in the same style as TrueCite and UrbanTrace:
dark rounded shell (#161B22), 18px vector icon, white label, glossy gradient value pill.

Run from anywhere: python docs/assets/badges/make_badges.py
"""
from pathlib import Path

HERE = Path(__file__).resolve().parent
CHAR_W = 6.35  # approx. advance width of 11.5px semibold system sans

def badge(slug, label, value, g0, g1, g2, border, icon, is_pulsing=False):
    label_w = len(label) * CHAR_W
    value_w = round(len(value) * 6.95 + 16)
    pill_x = round(32 + label_w + 10)
    width = pill_x + value_w + 4
    cx = pill_x + value_w / 2

    glow_style = ""
    shell_class = ""
    if is_pulsing:
        glow_style = """
    @keyframes shellPulse {
      0%, 100% { stroke: rgba(52, 211, 153, 0.45); stroke-width: 1px; }
      50% { stroke: rgba(52, 211, 153, 1.0); stroke-width: 1.4px; }
    }
    .pulsing-shell { animation: shellPulse 2.4s ease-in-out infinite; }"""
        shell_class = ' class="pulsing-shell"'

    return f"""<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} 32" width="{width}" height="32" fill="none">
  <defs>
    <linearGradient id="{slug}-grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="{g0}"/>
      <stop offset="50%" stop-color="{g1}"/>
      <stop offset="100%" stop-color="{g2}"/>
    </linearGradient>
    <linearGradient id="{slug}-gloss" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.22"/>
      <stop offset="45%" stop-color="#FFFFFF" stop-opacity="0.06"/>
      <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0.0"/>
    </linearGradient>
  </defs>
  <style>{glow_style}
    .badge-label {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 11.5px; font-weight: 600; fill: #FFFFFF; stroke: none; }}
    .badge-value {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 11.5px; font-weight: 700; fill: #FFFFFF; stroke: none; }}
  </style>
  <rect{shell_class} x="0.5" y="0.5" width="{width - 1}" height="31" rx="6" fill="#161B22" stroke="{border}" stroke-width="1"/>
  <g transform="translate(8, 7)">{icon}</g>
  <text x="32" y="20" class="badge-label">{label}</text>
  <rect x="{pill_x}" y="3.5" width="{value_w}" height="25" rx="4.5" fill="url(#{slug}-grad)" stroke="rgba(255,255,255,0.25)" stroke-width="0.8"/>
  <rect x="{pill_x}" y="3.5" width="{value_w}" height="25" rx="4.5" fill="url(#{slug}-gloss)"/>
  <text x="{cx}" y="20" text-anchor="middle" class="badge-value">{value}</text>
</svg>
"""

ICONS = {
    # Official Python Dual-Snake Icon (18x18px)
    "python": """<g transform="scale(0.75)"><path fill="#38BDF8" d="M11.95 0C5.45 0 5.86 2.8 5.86 2.8L5.87 5.7H12.1V6.65H3.6C3.6 6.65 0 6.24 0 12.74C0 19.24 3.14 18.96 3.14 18.96H5.02V16.32C5.02 16.32 4.9 13.16 8.08 13.16H14.28C14.28 13.16 17.29 13.27 17.29 10.39V2.8C17.29 2.8 17.7 0 11.95 0ZM8.9 1.83C9.52 1.83 10.02 2.33 10.02 2.95C10.02 3.57 9.52 4.07 8.9 4.07C8.28 4.07 7.78 3.57 7.78 2.95C7.78 2.33 8.28 1.83 8.9 1.83Z"/><path fill="#FACC15" d="M12.05 24C18.55 24 18.14 21.2 18.14 21.2L18.13 18.3H11.9V17.35H20.4C20.4 17.35 24 17.76 24 11.26C24 4.76 20.86 5.04 20.86 5.04H18.98V7.68C18.98 7.68 19.1 10.84 15.92 10.84H9.72C9.72 10.84 6.71 10.73 6.71 13.61V21.2C6.71 21.2 6.3 24 12.05 24ZM15.1 22.17C14.48 22.17 13.98 21.67 13.98 21.05C13.98 20.43 14.48 19.93 15.1 19.93C15.72 19.93 16.22 20.43 16.22 21.05C16.22 21.67 15.72 22.17 15.1 22.17Z"/></g>""",

    # Lightning bolt FastAPI Icon
    "fastapi": '<circle cx="9" cy="9" r="8.5" fill="#009688"/><path d="M10 3 L5 10.5 H9.5 L8.5 15 L14 8.5 H9.5 L10.5 3 Z" fill="#FFFFFF"/>',

    # Downscaling aperture / focal lens icon
    "downscale": '<circle cx="9" cy="9" r="8" fill="none" stroke="#34D399" stroke-width="1.6"/><path d="M9 3 A6 6 0 0 1 15 9" stroke="#6EE7B7" stroke-width="2" stroke-linecap="round"/><circle cx="9" cy="9" r="2.5" fill="#F59E0B"/>',

    # Orographic mountain ridge & rain-shadow icon
    "orography": '<path d="M1 15 L6 7 L10 12 L14 4 L17 15 Z" fill="none" stroke="#38BDF8" stroke-width="1.6" stroke-linejoin="round"/><path d="M12 2 L16 3 L14 7" stroke="#93C5FD" stroke-width="1.2" stroke-linecap="round"/>',

    # Panchayat coverage & cluster icon
    "coverage": '<circle cx="9" cy="7" r="4.5" fill="none" stroke="#C084FC" stroke-width="1.5"/><circle cx="9" cy="7" r="2" fill="#E879F9"/><path d="M4.5 15 C5.5 12 12.5 12 13.5 15" stroke="#C084FC" stroke-width="1.5" stroke-linecap="round"/>',

    # Console / Dashboard screen icon
    "console": '<rect x="1" y="2" width="16" height="13" rx="2" fill="none" stroke="#22D3EE" stroke-width="1.5"/><line x1="1" y1="6" x2="17" y2="6" stroke="#22D3EE" stroke-width="1"/><circle cx="3.5" cy="4" r="0.8" fill="#F87171"/><circle cx="6" cy="4" r="0.8" fill="#FBBF24"/><circle cx="8.5" cy="4" r="0.8" fill="#34D399"/>',

    # Engine chip / offline zero cloud icon
    "offline": '<rect x="3" y="3" width="12" height="12" rx="2" fill="none" stroke="#FB923C" stroke-width="1.5"/><rect x="6" y="6" width="6" height="6" rx="1" fill="#EA580C"/><path d="M6 1 V3 M12 1 V3 M6 15 V17 M12 15 V17 M1 6 H3 M1 12 H3 M15 6 H17 M15 12 H17" stroke="#FB923C" stroke-width="1.4" stroke-linecap="round"/>',

    # Tests flask verification icon
    "tests": '<path d="M5 2 H13 M9 2 V6.5 L3.5 15 C3 15.8 3.5 17 4.5 17 H13.5 C14.5 17 15 15.8 14.5 15 L9 6.5" fill="none" stroke="#34D399" stroke-width="1.6" stroke-linecap="round"/><path d="M6 13.5 L8 15.5 L12 10.5" fill="none" stroke="#FACC15" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',

    # License document icon
    "license": '<rect x="3" y="1.5" width="11" height="14" rx="1.6" fill="#E5E7EB"/><rect x="5" y="4.5" width="7" height="1.4" rx="0.7" fill="#6B7280"/><rect x="5" y="7.5" width="5" height="1.4" rx="0.7" fill="#6B7280"/><circle cx="13" cy="13" r="3.4" fill="#A3A3A3" stroke="#FFFFFF" stroke-width="1"/>'
}

BADGES = [
    ("python", "Python", "3.12", "#38BDF8", "#0284C7", "#0369A1", "rgba(56, 189, 248, 0.45)", ICONS["python"], False),
    ("fastapi", "FastAPI", "REST API", "#2DD4BF", "#0D9488", "#047857", "rgba(45, 212, 191, 0.45)", ICONS["fastapi"], False),
    ("downscale", "Downscaling", "LightGBM Quantile", "#6EE7B7", "#10B981", "#047857", "rgba(52, 211, 153, 0.45)", ICONS["downscale"], False),
    ("orography", "Orographic", "245-deg Rain Shadow", "#38BDF8", "#0284C7", "#1E40AF", "rgba(56, 189, 248, 0.45)", ICONS["orography"], False),
    ("coverage", "Coverage", "9,802 Panchayats", "#C084FC", "#9333EA", "#6B21A8", "rgba(192, 132, 252, 0.45)", ICONS["coverage"], False),
    ("console", "Dashboard", "React + MapLibre", "#22D3EE", "#0891B2", "#0E7490", "rgba(34, 211, 238, 0.45)", ICONS["console"], False),
    ("offline", "Engine", "NumPy ~100ms", "#FDBA74", "#EA580C", "#9A3412", "rgba(251, 146, 60, 0.45)", ICONS["offline"], False),
    ("tests", "Tests", "408 Passing", "#059669", "#047857", "#064E3B", "rgba(52, 211, 153, 0.7)", ICONS["tests"], True),
    ("license", "License", "MIT", "#D4D4D4", "#737373", "#404040", "rgba(163, 163, 163, 0.45)", ICONS["license"], False),
]

if __name__ == "__main__":
    HERE.mkdir(parents=True, exist_ok=True)
    for slug, label, value, g0, g1, g2, border, icon, is_pulse in BADGES:
        content = badge(slug, label, value, g0, g1, g2, border, icon, is_pulse)
        (HERE / f"{slug}.svg").write_text(content, encoding="utf-8")
        print(f"Generated {slug}.svg")
