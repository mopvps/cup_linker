---
name: vilpower-design
description: VilPower brand color theme — logo, accent colors, semantic colors. Use when styling UI in this repo (light/dark theme CSS vars).
---

# VilPower Design — Color Theme

## Logo
`logo.webp` (repo root). Render via `<img class="brand-logo">`. Fallback icon: `link-2` lucide, blue box, if logo fails load.

## Brand identity
Royal blue + forest green, drawn from VilPower logo (blue mark, green tree).

## Color tokens (light theme)

| Token | Value | Use |
|---|---|---|
| `--accent` | `#2B3A9C` | primary brand — royal blue |
| `--accent-hover` | `#1F2C7A` | hover state |
| `--accent-soft` | `#EEF1FB` | tinted background |
| `--accent-ring` | `rgba(43,58,156,.30)` | focus ring |
| `--pass` | `#4A7C3A` | forest green — success (from logo tree) |
| `--pass-soft` | `#F0F7ED` | |
| `--pass-line` | `#B8D9AB` | |
| `--fail` | `#B91C1C` | error red |
| `--fail-soft` | `#FEF2F2` | |
| `--fail-line` | `#FBBFBF` | |
| `--warn` | `#B45309` | warning amber |
| `--warn-soft` | `#FFFBEB` | |
| `--bg` | `#F6F7F9` | page background |
| `--bg-sidebar` | `#FFFFFF` | |
| `--surface` | `#FFFFFF` | card/panel |
| `--surface-2` | `#F1F3F6` | zebra/nested surface |
| `--border` | `#E3E8EF` | |
| `--border-strong` | `#CDD5DF` | |
| `--text` | `#111827` | |
| `--text-2` | `#4B5563` | |
| `--muted` | `#8A94A6` | |
| `--code-bg` | `#0E1626` | code panel (always dark) |
| `--code-text` | `#DCE3EE` | |

## Color tokens (dark theme — `[data-theme="dark"]`)

| Token | Value |
|---|---|
| `--accent` | `#5B6FD9` |
| `--accent-hover` | `#7A8CE8` |
| `--accent-soft` | `#1A2044` |
| `--pass` | `#6BA85A` |
| `--fail` | `#EF4444` |
| `--warn` | `#FBBF24` |
| `--bg` | `#0F172A` |
| `--bg-sidebar` / `--surface` | `#1E293B` |
| `--surface-2` | `#0F172A` |
| `--border` | `#334155` |
| `--text` | `#F1F5F9` |
| `--text-2` | `#CBD5E1` |
| `--muted` | `#64748B` |

## Rule
Never hardcode hex in components — always use CSS vars above (`var(--accent)` etc). Full set in `style.css:5-109`.

## Typography
Inter (UI text), JetBrains Mono (code/ids/prefixes). Loaded via Google Fonts.

## Icons
Lucide icons (`data-lucide="..."`), 16px default, 2px stroke.
