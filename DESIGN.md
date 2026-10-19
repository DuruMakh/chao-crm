---
name: Chao CRM
description: A mobile-first web application for calculating catering orders in real-time.
colors:
  bg: "#0f0f1a"
  surface: "#1a1a2e"
  surface-hover: "#222240"
  accent: "#8b5cf6"
  gold: "#f59e0b"
  text-primary: "#f0eef6"
  text-secondary: "#9896a8"
  text-muted: "#6b6980"
  success: "#10b981"
  error: "#ef4444"
typography:
  display:
    fontFamily: "'Playfair Display', Georgia, serif"
    fontSize: "clamp(1.2rem, 4vw, 1.4rem)"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  body:
    fontFamily: "'Inter', -apple-system, sans-serif"
    fontSize: "16px"
    lineHeight: 1.5
rounded:
  sm: "8px"
  md: "12px"
  lg: "16px"
  full: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
  "2xl": "48px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
    padding: "0 24px"
  button-primary-hover:
    backgroundColor: "#7c4ddb"
---

# Design System: Chao CRM

## 1. Overview

**Creative North Star: "The Obsidian Vault"**

A precise, high-contrast dark technical layout utilizing deep violet and warm amber accents. The design is tuned to deliver information density and speed on mobile screens. It rejects the generic saturated warm-beige backgrounds and rounded SaaS card-grids, using thin semi-transparent structural borders and color tinting instead to create visual rhythm and hierarchy.

**Key Characteristics:**
- Deep obsidian backdrop with low-opacity gradient accents.
- Elegant contrast between editorial serif headings and clean sans-serif data points.
- Precision lines and reactive hover/selection outlines.

## 2. Colors

The color palette uses a dark obsidian base accented with a single vivid violet signature and functional amber price highlights.

### Primary
- **Obsidian Violet** (`#8b5cf6`): The primary brand signature. Used sparingly (≤10% of any screen surface) for indicators, active buttons, and badges.

### Neutral
- **Deep Obsidian** (`#0f0f1a`): The background anchor for the whole interface.
- **Vault Surface** (`#1a1a2e`): Used for primary containment cards and interactive fields.
- **Surface Hover** (`#222240`): Indicates hover or active target focus.
- **Ink Primary** (`#f0eef6`): High contrast near-white body copy.
- **Ink Muted** (`#9896a8`): Muted gray-purple text for secondary details.
- **Ink Dark** (`#6b6980`): Text color for labels, placeholder inputs, and dividers.

### Named Rules
**The Rarity Rule.** The main accent color (Obsidian Violet) must never exceed 10% of the screen surface. Its rarity establishes its semantic meaning as an interactive state.
**The No-Gray Rule.** All neutrals are tinted with a micro-dose of purple to maintain color harmony and avoid clinical grays.

## 3. Typography

**Display Font:** 'Playfair Display' (with Georgia, serif fallback)
**Body Font:** 'Inter' (with -apple-system, sans-serif fallback)

**Character:** Editorial elegance meets high-density utility. Display headers carry a sophisticated serif tone, while body text and data grids maintain high-speed legibility with Inter.

### Hierarchy
- **Display** (Bold 700, `clamp(1.2rem, 4vw, 1.4rem)`, Line height 1.2, Letter spacing -0.01em): Used for the brand name and main section titles.
- **Headline** (Semi-Bold 600, `0.95rem`): Used for category headers.
- **Body** (Regular 400 / Medium 500, `0.92rem` / `0.9rem`, Line height 1.5): Used for product titles and general inputs.
- **Label** (Bold 600, `0.78rem` / `0.72rem`, Case: uppercase, Letter spacing 0.06em): Used for form fields and badges.

### Named Rules
**The Balance Rule.** All h1–h3 headings must use `text-wrap: balance` to prevent awkward line breaks on narrow viewports.

## 4. Elevation

The system is flat at rest. Hierarchy is conveyed via structural borders and background tonal shifts rather than floating card shadows. Soft shadows appear exclusively as active feedback on hover or active selections.

### Shadow Vocabulary
- **Primary Glow** (`box-shadow: 0 4px 16px rgba(139,92,246,0.3)`): Appears under brand icons and primary CTA buttons at rest.
- **Hover Glow** (`box-shadow: 0 6px 20px rgba(139,92,246,0.4)`): Applied when interactive buttons or card elements are hovered.
- **Gold Aura** (`text-shadow: 0 0 20px rgba(245,158,11,0.15)`): Highlight under active footer total figures.

### Named Rules
**The Flat-By-Default Rule.** Layout surfaces lie flat against the background. Shadows or glow gradients only appear when responding to user touch, selection, or hover.

## 5. Components

### Buttons
- **Shape:** Rounded corners (8px/12px radius)
- **Primary:** Background color Obsidian Violet (`#8b5cf6`), white text, shadow `0 4px 16px rgba(139,92,246,0.3)`.
- **Hover / Focus:** Shift background color to `#7c4ddb` and elevate scale to `scale(0.98)` or hover shadow `0 6px 20px rgba(139,92,246,0.4)`.

### Cards / Containers
- **Corner Style:** Rounded corners (16px radius)
- **Background:** Vault Surface (`#1a1a2e`) at rest.
- **Border:** Thin borders (`1px solid rgba(255,255,255,0.06)`).
- **Active State:** Border shifts to active tint (`rgba(139,92,246,0.3)`) and adds background gradient.

### Inputs / Fields
- **Style:** Background Deep Obsidian (`#0f0f1a`), thin border (`1px solid rgba(255,255,255,0.06)`), rounded corners (12px).
- **Focus:** Border shifts to Obsidian Violet (`#8b5cf6`) with shadow glow `0 0 0 3px rgba(139,92,246,0.12)`.

### Navigation / Headers
- **Style:** Position sticky, height (72px), background semi-transparent (`rgba(15,15,26,0.85)`) with backdrop blur (20px).

## 6. Do's and Don'ts

### Do:
- **Do** maintain strict WCAG AA contrast (≥4.5:1) for all body text and placeholder inputs.
- **Do** respect the `prefers-reduced-motion` media query by downgrading transitions to static swaps or simple crossfades.
- **Do** use `var(--clr-border)` for standard structural separation.

### Don't:
- **Don't** use generic cream, beige, or white card grids. Keep the interface locked to its dark obsidian palette.
- **Don't** animate image elements on hover. Hover state responses should be mapped to the card container's border or shadow.
- **Don't** add side-stripe accent borders to highlight cards.
