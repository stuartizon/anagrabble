# Anagrabble Design System

Anagrabble is an online word game: players race to form the largest words from a shared bank of letter tiles, and can steal each other's words by extending them with new letters (CAT + S → CAST). Games are played by 2+ human players (computer opponents planned later), on desktop or mobile browsers, with a turn timer governing tile reveals.

This is a **from-scratch design system** — no existing brand, codebase, or Figma file was provided. Every token, component, and screen here is an original direction built from the brief and the user's answers to a short direction survey (vibe, color, type pairing, logo, motif, scope). There is no logo mark: the brand uses a typographic wordmark only (see Iconography). If a real codebase, Figma file, or brand guidelines exist for Anagrabble, attach them and this system should be revised to match.

## Products covered
- **Game app** — desktop + mobile web, the core word-stealing game
- **Marketing landing site** — signup/info page
- **Social ad templates** — square + story format ad layouts

## Index
- `styles.css` — root stylesheet, imports all tokens (link this one file)
- `tokens/` — colors, semantic aliases, typography, spacing, radius, shadows
- `guidelines/` — foundation specimen cards (Design System tab)
- `components/core/` — Button, IconButton, Badge, Tag, Card
- `components/forms/` — Input, Select, Checkbox, Switch
- `components/feedback/` — Toast, Tooltip, Dialog
- `components/navigation/` — Tabs
- `components/game/` — LetterTile, PlayerScoreCard, PlayerChip, WordTag, Timer (intentional additions, see below)
- `components/brand/` — Wordmark
- `ui_kits/game/` — game app screens (desktop + mobile)
- `ui_kits/landing/` — marketing site
- `ui_kits/social-ads/` — social ad templates
- `assets/` — no image/logo assets provided; empty by design

## Intentional additions
No component source was provided, so the standard primitive set (Button, Input, Badge, etc.) was authored to brand needs. Five components go beyond that standard set because the product needs them structurally: **LetterTile** (the turned-over letter tile, the game's core visual unit), **PlayerScoreCard** (a player's name, live word list, and score), **PlayerChip** (a compact player summary — name, score, word count — for a horizontally-scrolling strip when a full PlayerScoreCard list won't fit, e.g. 4+ players on mobile), **WordTag** (a single claimed word tagged with its owner's identity color — shape and indicator style are variants), and **Timer** (the per-turn countdown). These are documented here rather than invented silently.

## Content fundamentals
Tone: dry-witty and precise, like a crossword clue rather than a hype app. Short, plain sentences. No exclamation points as a crutch, no forced excitement. Copy trusts the player to know what a word game is — it doesn't over-explain.

- **Voice**: second person ("your word," "you stole CAST from Sam") — the game addresses the player directly, but headlines can drop the pronoun entirely ("Steal a word. Add a letter.").
- **Casing**: sentence case everywhere — buttons, headings, labels. Never ALL CAPS for emphasis; never Title Case Every Word.
- **Punctuation**: periods on standalone statements, no exclamation points except perhaps a single celebratory moment (winning a game) — even then, restrained.
- **Vocabulary**: game and language terms used correctly and a little proudly (anagram, root word, steal, bank) — the nerdiness is real, not costumed.
- **Emoji**: not used in UI copy. The brand's playfulness comes from wit and layout, not emoji.
- **Numbers**: scores and timers are always numerals, never spelled out.

Example lines: "CAST steals CAT from Priya." / "Not a word we know. Try again." / "14 seconds left." / "You turned an S." Avoid: "🎉 Great job!! You WON!!"

## Visual foundations
**Palette** — restrained and paper-like, not saturated: a warm off-white paper background (`--paper` #FAF7F0) with near-black ink text (`--ink` #1B1B18), one working accent green (`--accent` #1F8A5C) for actions and success states, and a muted gold (`--gold` #C77D18) reserved for scores/highlights. One error red (`--error` #C1432D). No gradients, no purple/blue "AI" gradient, no more than two accent hues on screen at once.

**Type** — IBM Plex Mono for display/headings and anything numeric (scores, timers, tile letters) — the monospace nods to typewriters and crossword grids and reinforces the "nerdy" side of the brand. IBM Plex Sans for body copy and UI labels, so long-form reading stays comfortable. Headings are set tight (`--leading-tight`), body copy generous (`--leading-normal`).

**Backgrounds** — flat paper color, no photography, no full-bleed imagery, no hand-drawn illustration, no repeating pattern/texture. The only "texture" in the system is the letter tile itself (see Iconography) — it stays confined to the game board and score displays, not used as a decorative motif elsewhere (per direction: tile motif limited to the board).

**Shadows / elevation** — very subtle. Cards use `--shadow-sm` (a 1–2px soft shadow, no glow). Letter tiles get a slightly firmer `--shadow-tile` (a thin dark base edge + soft drop) so they read as small physical objects sitting on the board. No inner shadows, no neumorphism.

**Borders** — 1px, `--border` (a warm light tan, not pure gray) on cards and inputs; `--border-strong` for dividers that need more contrast. Borders do more visual work than shadows in this system — it's a bordered, paper-and-ink brand, not a floating-card one.

**Radius** — small and consistent: 4px for tiles and small chips, 8px for buttons/inputs, 14px for cards/modals. Never fully round rectangles (no pill-shaped cards); pill radius is reserved for true pills (tags, the timer badge).

**Hover / press states** — hover darkens fills slightly (accent → accent-dark) or adds a 1px border-strong on outline elements; no lift/scale on hover. Press states apply a 1px inset via `transform:translateY(1px)` plus a marginally darker fill — a small, tactile "press," matching a tile-and-board object language, not a bouncy one.

**Motion** — minimal and quick: 120–160ms ease-out for hover/press, a short scale+fade (150ms) when a tile flips face-up or a word is claimed. No spring/bounce easing, no parallax, no looping ambient animation. Motion communicates game state changes, not decoration.

**Transparency / blur** — used sparingly, only for temporary overlays (dialog backdrop at ~40% black, no blur) and toast entrances. No frosted-glass panels in the core UI.

**Imagery** — none provided or created for this system (no photography). If product photography or illustration is added later, keep it warm-neutral (paper-toned), not cool/blue, to match the palette.

**Cards** — `--surface-card` (white) fill, 1px `--border`, 14px radius, `--shadow-sm`. No colored left-border accent strips.

## Iconography
No icon set, sprite, or icon font was provided. **Lucide** (CDN, MIT-licensed line icons) is used as the icon set — its clean, even-weight stroke style matches the restrained, linear character of the type and tile system. Icons are always single-color (currentColor), 20px in UI chrome, 1.5px stroke. No emoji in the interface. No unicode characters used as icons. If Anagrabble commissions its own icon set later, this system should switch to it.

## Logo
No logo file was provided. Per the brief, the brand uses a plain typographic wordmark — "Anagrabble" set in `--font-display` (IBM Plex Mono), medium weight, tight tracking — wherever a mark would normally go. See `components/brand/Wordmark.jsx`. This is not a logo design; treat it as a placeholder until a real mark exists.

## Sources
None attached — no Figma link, GitHub repo, or codebase was provided for this project. All decisions above originated from the product brief and a short direction survey answered by the user (vibe: clean nerdy-minimal; primary accent: #1F8A5C; logo: typographic wordmark; tile motif: confined to board; icon set: decided as Lucide; type pairing: decided as mono display + sans body).
