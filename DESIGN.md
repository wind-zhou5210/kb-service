---
name: 文件知识库
description: 工程图纸·规格单 — 知识如图纸：精确、受控、可追溯。
colors:
  # 制图墨（唯一强调色）
  primary: "#3A5BD9"
  primary-press: "#2C46AE"
  primary-tint: "#EAEFFC"
  # 暖纸表面
  paper: "#F4F3EE"
  surface: "#FBFBF7"
  subtle-bg: "#EEECE4"
  border: "#DCD9CE"
  border-strong: "#C2BFB4"
  # 暖墨（文本 / 尺寸线）
  ink-900: "#1E1D1A"
  ink-800: "#2E2D29"
  ink-700: "#3F3E38"
  ink-600: "#4F4D45"
  ink-500: "#5F5C53"
  ink-400: "#6F6C61"
  ink-300: "#9C988C"
  ink-200: "#C4C1B5"
  ink-100: "#DEDCD2"
  # 语义
  danger: "#B93A32"
  danger-tint: "#FBEEEC"
  success: "#3E7C3E"
  warning-tint: "#FBF0DC"
  warning-border: "#E4C181"
  warning-text: "#7A5314"
  # 文件类型
  md-file: "#2C5FBE"
  html-file: "#B05A17"
  # 品牌区（夜间蓝图深海军蓝）
  brand-bg: "#1B2340"
  brand-ink: "#C6CFEA"
  # 品牌区叠加（夜间蓝图上的白色/蓝色半透明图层）
  brand-border: "rgba(150,170,220,0.25)"
  brand-glow: "rgba(120,150,220,0.18)"
  brand-frame: "rgba(150,170,220,0.22)"
  brand-mark-bg: "rgba(255,255,255,0.10)"
  brand-mark-border: "rgba(255,255,255,0.18)"
  brand-icon-bg: "rgba(255,255,255,0.07)"
  brand-icon-border: "rgba(255,255,255,0.14)"
  # 渐变图纸封面（白色文字/虚线压线）
  on-cover: "#FFFFFF"
  cover-hatch: "rgba(255,255,255,0.5)"
  # 暗色墨块（夜间代码块）
  ink-block: "#0E0F13"
typography:
  display:
    fontFamily: "'IBM Plex Sans', -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: "32px"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "'IBM Plex Sans', -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: "20px"
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  title:
    fontFamily: "'IBM Plex Sans', -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "-0.01em"
  body:
    fontFamily: "'IBM Plex Sans', -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "normal"
  reading:
    fontFamily: "'IBM Plex Sans', -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.7
    letterSpacing: "normal"
  button:
    fontFamily: "'IBM Plex Sans', -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "'JetBrains Mono', 'IBM Plex Mono', 'SF Mono', 'Fira Code', ui-monospace, 'SFMono-Regular', monospace"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "0.02em"
rounded:
  sm: "3px"
  md: "5px"
  lg: "7px"
  widget: "6px"
  widget-lg: "8px"
spacing:
  1: "4px"
  2: "8px"
  3: "12px"
  4: "16px"
  5: "20px"
  6: "24px"
  8: "32px"
  12: "48px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "#FFFFFF"
    typography: "{typography.button}"
    rounded: "{rounded.widget}"
    height: "32px"
  button-primary-hover:
    backgroundColor: "{colors.primary-press}"
  button-primary-active:
    backgroundColor: "{colors.primary-press}"
  button-tab:
    backgroundColor: "transparent"
    textColor: "{colors.ink-500}"
    typography: "{typography.button}"
    rounded: "{rounded.widget}"
    height: "32px"
  button-tab-active:
    backgroundColor: "{colors.primary}"
    textColor: "#FFFFFF"
  input-search:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-900}"
    rounded: "{rounded.widget}"
    height: "32px"
  sheet-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-900}"
    rounded: "{rounded.lg}"
    padding: "20px 20px 16px"
  doc-item:
    backgroundColor: "transparent"
    textColor: "{colors.ink-800}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
  doc-item-active:
    backgroundColor: "{colors.primary-tint}"
    textColor: "{colors.primary-press}"
  tag-chip:
    backgroundColor: "{colors.subtle-bg}"
    textColor: "{colors.ink-600}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
  dim-label:
    textColor: "{colors.ink-400}"
    typography: "{typography.label}"
---

# Design System: 文件知识库

## Overview

**Creative North Star: "The Engineering Spec Sheet"**

The product treats knowledge the way an engineer treats a drawing sheet: precise, controlled, traceable. Every collection is a sheet with a title block and a drawing number; every document is a specification read inside ruled margins; measurements and annotations stay visible instead of hiding in hover states. The build rejects the generic admin-shell "knowledge tool uniform" and the cream-serif editorial default that most knowledge products reach for.

The world is drawn in four materials: a warm paper sheet, near-black warm ink, a single restrained indigo drafting ink, and warm-gray dimension lines. Monospace carries every drawing number and measurement. The drafting grid, dimension ticks, annotation bubbles (blockquotes), registration marks, and double-line title block are the recurring motifs. Chromatic variety is deliberately quarantined to the hash-derived gradient covers on sheet cards — the only place a plot palette appears. Dark mode is the night drafting page: the paper inverts to dark slate and the ink inverts to near-white, while the accent lifts to a pale blueprint blue for contrast.

The build lands the direction contract with two deliberate refinements. First, the fine grid paper is a list-page material only — the reading column stays on plain paper so the rules never compete with the prose. Second, the contract named a single indigo accent; the shipped cards add a hash-stable gradient cover layer (ten preset pairs, "plot color") that gives every sheet a stable, name-derived identity without loosening the restrained drafting ink everywhere else.

**Key Characteristics:**
- Warm paper surfaces and warm near-black ink; no pure black, no pure gray.
- One indigo drafting ink used as thin structural marks — underlines, spines, focus rings, ridges — never as decorative fill.
- Monospace (JetBrains Mono) carries all sheet numbers, counts, sizes, timestamps, and file extensions.
- 20px drafting grid on list pages only; the reading column is plain paper.
- Title-block header (2px ink rule + dashed accent rule), dimension ticks, registration marks, annotation bubbles.
- Self-hosted OFL fonts (IBM Plex Sans + JetBrains Mono); offline, no runtime CDN.
- Light paper / night-blueprint dark themes, switchable with no state loss.

## Colors

Warm drafting palette: warm paper + warm near-black ink + a single indigo drafting ink + warm-gray dimension lines. No pure gray steps and no pure black anywhere.

### Primary
- **Drafting Indigo** (#3A5BD9; dark #7C9CEB): the single accent. Applied as thin structural marks — the 3px page-title underline, 2px left spines on active list items and code blocks, blockquote borders, focus rings, the dashed rule under the header. The only full-surface uses are the primary button and the active header tab.
- **Drafting Indigo Pressed** (#2C46AE; dark #A5BCF2): hover/press of the accent, active list-item title, selection text.
- **Drafting Indigo Tint** (#EAEFFC; dark #1C2747): the accent's wash — active list-item background, blockquote background, note band, text selection. Always pairs with an accent stroke or text; never used as a bare field.

### Neutral
- **Warm Paper** (#F4F3EE; dark #131419): page background. The sheet the whole world is drawn on.
- **Sheet Surface** (#FBFBF7; dark #1A1B21): card and panel background; the header. One step lighter than the page in light mode, one step lighter in dark.
- **Subtle Surface** (#EEECE4; dark #212228): hover wash for list rows, inline-code background, avatar/tile fill.
- **Warm Ink** (#1E1D1A; dark #EAE8E2): primary text. In light mode it is near-black with a warm cast; in dark mode it inverts to near-white paper ink. Scale: ink-900 #1E1D1A, ink-800 #2E2D29, ink-700 #3F3E38, ink-600 #4F4D45, ink-500 #5F5C53, ink-400 #6F6C61 (dimension gray), ink-300 #9C988C, ink-200 #C4C1B5, ink-100 #DEDCD2.
- **Warm-Gray Dimension Line** (#6F6C61; dark #8B887F): the ink-400 step, reserved for spec labels, dimension ticks, and quiet captions.
- **Border** (#DCD9CE; dark #2C2D34): 1px hairlines between surfaces. **Border Strong** (#C2BFB4; dark #3D3E46): dashed empty-state outlines.

### Secondary
- **Red Line** (#B93A32; dark #E07A72): destructive action text and confirmations. Its tint (#FBEEEC / dark #2B1C1B) fills danger-adjacent washes.
- **Plot Green** (#3E7C3E; dark #6FB06F): success states only.
- **Drafting Amber** (#E4C181 border / #7A5314 text / #FBF0DC tint; dark #6B5326 / #D9B46A / #33291A): replace-mode warnings and other amber advisories.
- **Markdown Blue** (#2C5FBE; dark #7CA7F0) and **HTML Amber** (#B05A17; dark #E09A55): file-type glyphs in lists, trees, and search results — the only two colors that tag file kind.

### Tertiary
- **Night Blueprint** (#1B2340 bg / #C6CFEA ink; dark #10121A / #9AA7CC): the login brand panel and the header logo mark. This is the drafting room's "night blue" — the only navy in the system, always paired with its own cyan grid.

### Named Rules
**The One Accent Rule.** Indigo is applied as thin structural marks; full-surface indigo is reserved for the primary button and the active header tab. The accent's rarity is the point — a screen should read as ink on paper with a few precise blue strokes, not a blue UI.

**The Red-Line Rule.** #B93A32 is reserved for destructive actions and their confirmations. It never decorates, never appears on non-destructive chrome.

**The No Pure Black Rule.** Text and lines are warm ink, never #000. Surfaces are warm paper, never pure gray. Every neutral carries a warm cast.

**The Plot-Color Rule.** Chromatic variety is quarantined to sheet-card covers, where a stable hash of the sheet name picks one of ten preset gradient pairs (blue-violet, indigo-purple, cyan-blue, green, amber-red, magenta-violet, teal-cyan, indigo-purple, orange-yellow, blue-blue). The same name always gets the same cover; no other surface borrows these colors.

## Typography

**Display Font:** IBM Plex Sans (400 / 500 / 600), self-hosted woff2 under SIL OFL 1.1, with system CJK fallbacks (PingFang SC / Microsoft YaHei / Noto Sans CJK).
**Body Font:** IBM Plex Sans.
**Label/Mono Font:** JetBrains Mono (400 / 500 / 600), self-hosted woff2 under SIL OFL 1.1.

**Character:** An industrial, engineering-humanist sans paired with a coding mono. IBM Plex Sans reads like it was drawn for instrument panels and manuals — precise and technical rather than editorial or friendly. JetBrains Mono carries every measurement, sheet number, and spec caption, which is what sells the drafting-room voice. Layering note: antd widget primitives (menus, modals, selects, tags) are wired through the ConfigProvider with a separate system stack, so they render in the OS UI font while every custom surface inherits IBM Plex Sans from the body.

### Hierarchy
- **Display** (IBM Plex Sans, 700, 32px, line-height 1.3, letter-spacing -0.02em): the login brand hero only. White on Night Blueprint.
- **Headline** (IBM Plex Sans, 650, 20px, line-height 1.2, letter-spacing -0.02em): page titles (知识集合, 工作空间), each with a 44×3px indigo underline. In reading content, h1 rises to 26px and h2 to 20px, both 650, both with a ruled underline (2px ink rule for h1, 1px border for h2).
- **Title** (IBM Plex Sans, 600, 14px, line-height 1.4, letter-spacing -0.01em): sheet-card titles, sidebar names, document header titles (15px 600 in the reading top bar).
- **Body** (IBM Plex Sans, 400, 13px, line-height 1.55): UI body text, card descriptions, hint lines.
- **Reading** (IBM Plex Sans, 400, 16px, line-height 1.7): the markdown reading column, the largest body text in the system. Held to a 760px measure and plain paper.
- **Label** (JetBrains Mono, 500, 11px, letter-spacing 0.02em): dimension labels (.dim), title strips, spec captions. Uppercase spec labels (TOC label, cover number) letter-space at 0.06em.

### Named Rules
**The Mono-Spec Rule.** Every measurement — file counts, sizes, timestamps, version numbers, file extensions, sheet numbers — is set in JetBrains Mono at 10–12px. Spec text is never set in sans.

**The Sheet-Number Rule.** Every sheet carries a mono drawing number: `KB-###` for collections, `WS-###` for workspaces, `SHT-0#` for the header's current-sheet label (SHT-01 知识集合, SHT-02 工作空间, SHT-03 检索).

**The Reading-Is-Largest Rule.** The reading column sets the largest body text in the system (16px); the shell UI stays at 13–14px so the chrome never competes with the prose.

## Layout

The system runs on a 4px spacing grid (`--space-1` 4px … `--space-12` 48px). Page containers hold a 1200px max width; the reading column is constrained to 760px (`--content-max`) and centered.

The shell is a stacked drafting title block: a 56px header (title block with the 2px ink rule and dashed accent rule) over a 40px subnav (breadcrumbs + page actions). Detail pages (collections, workspaces) use a three-column arrangement: a 280px left sidebar (`--sidebar-w`) for the file list or directory tree, a fluid content column on plain `--surface`, and a 240px right TOC rail (`--toc-w`) that appears only when a Markdown document is open.

List pages — 知识集合 and 工作空间 — sit on the 20px drafting grid (`.paper-grid`), a pair of 1px linear-gradient hairlines at `rgba(95,92,83,0.055)` on a 20px pitch. The grid is a list-page material only; the reading column is deliberately left on plain paper.

Sheet-card grids use a 20px gutter with responsive columns: xs 24 / sm 12 / md 8 / lg 8 / xl 6.

Breakpoints: at 1024px the TOC rail is hidden and reading padding compresses to 24px. At 768px the header compresses to 12px padding, page-container padding drops to 20px/16px, the page header wraps, and the left sidebar is replaced by a left Drawer (width `min(320px, 85vw)`); the login brand panel is hidden entirely. On `pointer: coarse` devices, list rows, tree nodes, and header buttons guarantee a 44px minimum touch target.

Density is compact and technical: base UI text 13px, list rows ~36px tall, a 56px header, a 40px subnav.

## Elevation & Depth

Flat by default. Depth is conveyed by ruled lines and borders, not shadows: the header's 2px ink rule, 1px surface hairlines, the inset accent ring on active list items, and the 2px rule that opens every title strip. Surfaces are flat at rest; shadows appear only as a response to hover.

### Shadow Vocabulary
- **ambient-low** (`0 1px 2px rgba(50,46,38,0.06)`): the quiet resting shadow token; barely-there.
- **ambient-md** (`0 2px 8px rgba(50,46,38,0.08)`): search-result hover lift.
- **ambient-lg** (`0 8px 24px rgba(50,46,38,0.10)`): sheet-card hover, paired with a -2px translateY and an ink-400 border.
- Dark theme deepens all three with black-based shadows (`rgba(0,0,0,0.3 / 0.4 / 0.5)`).

### Named Rules
**The Flat-By-Default Rule.** Surfaces are flat and defined by 1px borders and ruled lines at rest. Shadows are a hover-only response and stay warm and soft — no hard offset, no neobrutalist drop.

## Shapes

The form language is drafting-instrument precision: small radii, sharp hairlines, technical silhouettes. Radius scale is 3px (sm), 5px (md), 7px (lg); antd widgets use 6px and elevated surfaces (cards, modals) 8px. Cards are nearly-rectangular sheets, never pill-rounded.

Recurring geometric details carry the world: the 14px registration mark (a plus sign with a center dot, drawn with 2px strokes in `currentColor`), the dimension label's paired 6×1px tick marks, and the 3px accent ridge that opens code blocks and blockquotes (right corners rounded, left corners square). Empty states use a 1px dashed strong border. Active list items close with a 1px accent ring inset and a 1px accent spine on the left edge.

## Components

### Buttons
- **Shape:** radius 6px, height 32px default, font-weight 500, IBM Plex Sans 13px.
- **Primary:** Drafting Indigo fill (#3A5BD9), white text. Used for creation and primary actions (新建, 上传文件, 登录). The login primary is block, height 42px.
- **Hover / Focus:** hover and press darken to Drafting Indigo Pressed (#2C46AE); focus shows the global focus ring (2px outline, accent 35%, offset 2px).
- **Text / tab:** transparent, ink-500 text, used for header navigation tabs and icon buttons; active tab fills Drafting Indigo with white text. Icon buttons sit at ink-400 and warm to the accent on hover.

### Chips
- **Style:** JetBrains Mono 10px, height 16px, subtle-surface background, 1px border, radius 3px, ink-600 text. Used for document tags and version badges (`v2`, `+3`).
- **State:** plain tag chips are inert; file-extension tags in the reading top bar tint indigo (`blue`) for `.md` and orange for `.html`.

### Cards / Containers
- **Corner Style:** radius 7px (lg).
- **Background:** Sheet Surface (#FBFBF7).
- **Shadow Strategy:** flat at rest (1px border); hover lifts with ambient-lg + -2px translateY + ink-400 border.
- **Border:** 1px `--border`.
- **Internal Padding:** body 20px 20px 16px.
- **Structure:** a 44px gradient cover strip (hash-derived plot color) carrying a mono initial and a mono sheet number, with a dashed bottom edge; then the body (title 14px/600, description 13px clamped to 2 lines); then the title strip — a mono spec row opened by a 2px rule, with `<b>` cells at ink-600.

### Inputs / Fields
- **Style:** antd input, radius 6px, Sheet Surface background, 1px border, IBM Plex Sans 13px. Header search is 240px × 32px; list filters are compact.
- **Focus:** global focus ring (2px outline, accent 35%, offset 2px); search fields tint their border to the accent on focus-within.
- **Error / Disabled:** antd error styling with Red Line (#B93A32); disabled text at ink-300.

### Navigation
- **Header (title block, 56px):** Sheet Surface, 2px ink rule bottom border, then a dashed accent rule (indigo 6px dash / 4px gap, 35% opacity) beneath it. Contents: navy logo mark + wordmark with a mono spec subline (KB · 自托管文件知识库), two nav tabs (知识集合 / 工作空间), a dimension-label sheet number (SHT-0#), a search field, a theme toggle, a registration mark, and an avatar. Sticky.
- **Subnav (40px):** breadcrumbs (13px, `/` separators at ink-300) plus page-level actions, on Sheet Surface under a 1px rule.
- **TOC rail (240px):** uppercase mono label (本页目录), a 1px rail on the left, items at 12px ink-500 with indent per level; active item turns indigo and its rail segment turns indigo.

### Lists / Rows
- **Document item:** 8px/12px padding, radius 5px, hover washes subtle-surface. The active item fills Drafting Indigo Tint, closes with a 1px inset accent ring and a 1px accent spine, and its title turns Drafting Indigo Pressed. File glyphs color by type (Markdown Blue / HTML Amber); the spec row beneath is JetBrains Mono 10px ink-400. The share action is hidden (opacity 0) until hover.

### Signature Components
- **Dimension label (.dim):** the world's measurement voice — JetBrains Mono 11px ink-400 with a 6×1px tick at each end, used for the header sheet number and quiet specs.
- **Registration mark (.reg-mark):** a 14px plus-sign with a 4px center dot in `currentColor`; the smallest drafting detail, present in the header and the login brand corner.
- **Empty state:** a dashed strong-border sheet (radius 7px) on Sheet Surface with a subtle tile icon (56px, 1px border, subtle-surface fill).

## Do's and Don'ts

### Do:
- **Do** set every measurement — counts, sizes, timestamps, sheet numbers, versions, extensions — in JetBrains Mono at 10–12px (The Mono-Spec Rule).
- **Do** apply indigo as thin structural marks (3px underlines, 2px spines, focus rings, ridges) and reserve full-surface indigo for the primary button and active header tab (The One Accent Rule).
- **Do** give every sheet a mono drawing number — `KB-###`, `WS-###`, `SHT-0#` (The Sheet-Number Rule).
- **Do** use the 20px paper grid on list pages, and keep the reading column on plain paper (The Reading Plain-Paper Rule).
- **Do** write text in warm ink on warm paper — never pure black, never pure gray (The No Pure Black Rule).
- **Do** self-host the OFL font pair; the build ships no runtime font CDN.
- **Do** keep the reading column the largest text in the system (16px) against a 13–14px shell.

### Don't:
- **Don't** use pure black (#000) or pure gray for text or lines — the neutrals always carry a warm cast.
- **Don't** add hard offset or neobrutalist shadows — depth is flat-at-rest with warm, soft, hover-only shadows (The Flat-By-Default Rule).
- **Don't** run the drafting grid under reading content; the prose column stays on plain paper so the rules never compete with the text.
- **Don't** use the indigo accent as a decorative filled area beyond the primary button and active tab — its rarity is the point.
- **Don't** set spec text in sans, or body text in mono; the two families never trade jobs.
- **Don't** introduce a second accent or shift the card covers outside the fixed ten-pair hash palette — chromatic variety lives only on sheet covers (The Plot-Color Rule).
- **Don't** use Red Line (#B93A32) anywhere except destructive actions and confirmations (The Red-Line Rule).
