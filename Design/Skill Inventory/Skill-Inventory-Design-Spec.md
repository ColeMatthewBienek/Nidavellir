# Skill Inventory — Design Specification

## Overview

The Skill Inventory screen is a comprehensive management interface for viewing, filtering, and importing AI agent skills. It provides visibility into skill status, provider compatibility, trigger conditions, and capabilities with a progressive disclosure detail drawer pattern.

---

## Layout & Navigation

### Main Container
- **Type:** Full-height flex layout
- **Structure:** Two-column (list + detail drawer)
- **Background:** `BG1` (#0a0a0a)

### Header Section
- **Title:** "Skill Inventory"
- **Subtitle:** Dynamic stats: `{totalSkills} loaded · {enabledCount} enabled · {needsReviewCount} needs review`
- **Actions:**
  - `+ Import Skill` button (secondary, small)
  - `Compile Preview` button (secondary, small)

### Filter Bar
- **Position:** Below header, sticky
- **Style:** Horizontal button group
- **Options:**
  - All (default)
  - Enabled
  - Disabled
  - Needs Review (labeled as "Review")
- **Active state:** Green border + green background tint
- **Behavior:** Click filters the skill list, maintains grouping

---

## Skill Data Model

```javascript
{
  id: string,              // Unique identifier (e.g., '01', '02')
  slug: string,            // URL-safe identifier (e.g., 'spec-authoring')
  name: string,            // Display name
  status: enum,            // 'enabled' | 'disabled' | 'needsreview' | 'importfailed'
  sourceFormat: enum,      // 'native' | 'claude_skill' | 'imported_repo'
  desc: string,            // One-sentence description
  triggers: [              // Intent/keyword triggers
    {
      type: 'intent' | 'keyword',
      val: string,
      weight: 0.0–1.0
    }
  ],
  capabilities: string[],  // e.g., ['file-read', 'file-write', 'code-exec', 'vision', 'long-context', 'shell']
  providers: [             // LLM compatibility matrix
    {
      p: 'Claude' | 'Codex' | 'Gemini' | 'Ollama',
      s: 'compatible' | 'degraded' | 'unsupported'
    }
  ],
  lastActivated: string,   // e.g., 'today', '1h ago', '3h ago', 'never'
  runs: number,            // Total execution count
  scope: 'Global' | 'Project' // Availability scope
}
```

---

## Skill Card

### Card Container
- **Width:** Full (no max-width on container; grid layout for grouping)
- **Padding:** 14px
- **Border:** 1px solid `BD` (#2a2a2a); green (`GRN`) when selected
- **Border radius:** 6px
- **Background:** `BG1`
- **Cursor:** pointer
- **Transition:** border-color 0.15s ease

### Card Header Row
- **Layout:** flex, space-between
- **Left:** ID + Name + Description
  - ID: `fontFamily: MONO, fontSize: 10px, color: T1, background: BG2, padding: 2px 8px, borderRadius: 4px`
  - Name: `fontSize: 13px, fontWeight: 600, color: T0, marginBottom: 4px`
  - Description: `fontSize: 11px, color: T1, margin: 0, lineHeight: 1.6`
- **Right:** Status badge
  - Style: `padding: 2px 8px, borderRadius: 4px, fontSize: 9px, fontWeight: 600, textTransform: capitalize`
  - Colors:
    - Enabled: `background: GRN + '22', border: 1px solid GRN + '44', color: GRN`
    - Disabled: `background: T1 + '22', border: 1px solid T1 + '44', color: T1`
    - Needs Review: `background: YEL + '22', border: 1px solid YEL + '44', color: YEL`
    - Import Failed: `background: RED + '22', border: 1px solid RED + '44', color: RED`

### Card Metadata Row 1: Triggers
- **Layout:** flex, wrap
- **Chips:** `fontSize: 9px, padding: 2px 6px, background: BG2, border: 1px solid BD, borderRadius: 2px, color: T1, fontFamily: MONO`
- **Format:** `{type}: {value}`
- **Example:** "intent: implementation spec", "keyword: TDD"

### Card Metadata Row 2: Providers
- **Component:** ProviderChip
- **Layout:** flex, wrap, gap: 6px
- **See below for chip design**

### Card Footer: Stats
- **Layout:** flex, gap: 16px
- **Format:** `{label}: {value}`
- **Content:** Last activation, run count, scope
- **Style:** `fontSize: 10px, color: T1`

---

## Provider Compatibility Chip

### Visual Design
- **Background:** Semi-transparent provider color (e.g., `GRN + '22'` for compatible)
- **Border:** 1px solid color with reduced opacity (e.g., `GRN + '33'`)
- **Border radius:** 3px
- **Padding:** 2px 6px
- **Font:** `fontFamily: MONO, fontSize: 9px`

### Compatibility Symbols & Colors
| Status | Symbol | Color | Meaning |
|--------|--------|-------|---------|
| compatible | ✓ | GRN | Full support |
| degraded | ⚠ | YEL | Reduced functionality |
| unsupported | ✕ | RED | Not compatible |
| unknown | ? | T1 | Unknown status |

### Chip Content
- **Format:** `{ProviderName} {Symbol}`
- **Example:** `Claude ✓`, `Gemini ⚠`, `Ollama ✕`
- **Tooltip:** `${provider}: ${status}` (capitalized)

---

## Grouping & Filtering

### Grouping Logic
Skills are grouped by status in the following order:
1. **Needs Review** (if any)
2. **Enabled** (if any)
3. **Disabled** (if any)
4. **Import Failed** (if any)

### Group Header
- **Style:** `fontSize: 11px, fontWeight: 600, color: T1, textTransform: uppercase, letterSpacing: 0.7px`
- **Format:** `{STATUS} ({count})`
- **Example:** "Needs Review (1)", "Enabled (3)"
- **Margin:** 10px below, 28px between groups

### Filter Behavior
- Click a filter option (e.g., "Enabled") to show only skills with that status
- "All" shows all skills in their grouped layout
- Filter choice persists in component state; does not persist across page reload

---

## Detail Drawer

### Trigger
- Click any skill card to open drawer
- Click card again to close
- Click ✕ button in drawer to close

### Dimensions
- **Width:** 300px
- **Position:** Right side, full height
- **Border:** Left border 1px solid `BD`
- **Background:** `BG1`

### Header (Drawer)
- **Padding:** 12px 14px
- **Border-bottom:** 1px solid `BD`
- **Layout:** flex, space-between
- **Title:** `fontSize: 12px, fontWeight: 600, color: T0` (skill name)
- **Close Button:** `cursor: pointer, fontSize: 14px, color: T1`

### Content Sections (8 total)

#### 1. Overview
- **Title:** "Overview"
- **Items:**
  - Status: `{STATUS_LABELS[status]}`
  - Source: `{sourceFormat}` (e.g., "native", "claude_skill", "imported_repo")
  - Scope: `{scope}` (e.g., "Global", "Project")
- **Style:** `fontSize: 10px, color: T1, labels: color: T0, fontWeight: 500, lineHeight: 1.6`

#### 2. Triggers
- **Title:** "Triggers"
- **Layout:** flex column, gap: 3px
- **Item:** `fontSize: 9px, color: T1, padding: 4px 6px, background: BG0, borderRadius: 2px, fontFamily: MONO`
- **Format:** `<span style={{color: GRN}}>{type}:</span> {value}`

#### 3. Capabilities
- **Title:** "Capabilities"
- **Layout:** flex, wrap, gap: 3px
- **Item:** `fontSize: 8px, padding: 2px 5px, background: BG0, border: 1px solid BD, borderRadius: 2px, color: T1, fontFamily: MONO`

#### 4–8. Additional Sections (reserved for expansion)
- Compatibility (detailed view of all providers)
- Custom metadata
- Related skills
- Documentation
- Action buttons

### Section Header Style
- **Consistent across all sections:**
  - `fontSize: 9px, color: T1, textTransform: uppercase, fontWeight: 600, marginBottom: 6px`

---

## Import Skill Modal

### Trigger
- Click "+ Import Skill" button in header

### Modal Container
- **Position:** Fixed, centered
- **Overlay:** `background: #00000088` (semi-transparent black)
- **Dialog:** `background: BG1, border: 1px solid BD, borderRadius: 8px`
- **Dimensions:** 500px wide, max-height 80vh, scrollable
- **Z-index:** 30

### Modal Header
- **Padding:** 16px 20px
- **Border-bottom:** 1px solid `BD`
- **Layout:** flex, space-between
- **Title:** `fontSize: 14px, fontWeight: 600, color: T0`
- **Close button:** `cursor: pointer, fontSize: 16px, color: T1, onClick: setShowImport(false)`

### Modal Content

#### 1. Source Selection
- **Title:** "Select Source" (uppercase, fontSize: 11px, fontWeight: 600, color: T1, marginBottom: 8px)
- **Options (3):**
  - Upload Skill Package
  - Paste Markdown
  - Local Folder
- **Option Style:** `padding: 10px 12px, background: BG2, border: 1px solid BD, borderRadius: 4px, cursor: pointer, fontSize: 12px, color: T0`
- **Hover/Click:** (State managed by child component; recommend highlight on click)

#### 2. Security Notice
- **Background:** `YEL + '12'` (semi-transparent yellow)
- **Border:** 1px solid `YEL + '33'`
- **Border radius:** 4px
- **Padding:** 12px
- **Title:** "Security Notice" (fontSize: 10px, color: YEL, fontWeight: 600, marginBottom: 4px)
- **Message:** "Imported skills are disabled until reviewed. Nidavellir never executes imported skill files or scripts."
- **Message style:** `fontSize: 9px, color: YEL, lineHeight: 1.5`

#### 3. Action Buttons (Footer)
- **Layout:** flex, gap: 8px
- **Buttons:**
  - Cancel (secondary, small)
  - Continue (primary, small, onClick: setShowImport(false))

---

## Color Palette

| Token | Value | Usage |
|-------|-------|-------|
| BG0 | #000000 | Deep backgrounds |
| BG1 | #0a0a0a | Card/panel background |
| BG2 | #1a1a1a | Alternate background |
| T0 | #ffffff | Primary text |
| T1 | #808080 | Secondary text |
| BD | #2a2a2a | Borders |
| GRN | #10b981 | Success/enabled |
| YEL | #f59e0b | Warning/review |
| RED | #ef4444 | Error/failed |
| PRP | #a78bfa | Accent/tags |
| MONO | "Monaco", monospace | Code/ID text |

---

## Typography

| Role | Font | Size | Weight | Color |
|------|------|------|--------|-------|
| Screen title | System | 16px | 600 | T0 |
| Card title | System | 13px | 600 | T0 |
| Card description | System | 11px | 400 | T1 |
| Drawer title | System | 12px | 600 | T0 |
| Section header | System | 9px | 600 | T1 |
| Metadata | System | 10px | 400 | T1 |
| ID/Token | MONO | 10px | 400 | T1 |
| Trigger/Capability | MONO | 9px | 400 | T1 |

---

## Interactions

### Skill Card Hover
- **Cursor:** pointer
- **Visual:** No change (reserved for future)

### Skill Card Click
- **Behavior:** Toggle detail drawer (open if closed, close if open)
- **Same card click twice:** Closes drawer

### Filter Button Click
- **Behavior:** Update filtered list, reset selected skill (close drawer)
- **Visual:** Active filter shows green border and background tint

### Import Button Click
- **Behavior:** Open modal overlay
- **Modal appears above main content, behind overlay**

### Modal Close (✕)
- **Behavior:** `setShowImport(false)`, hide modal, return focus to main content

### Drawer Close (✕)
- **Behavior:** `setSel(null)`, hide drawer, maintain filter state

---

## Responsive Behavior

- **Desktop (1920px+):** Full two-column layout, drawer 300px
- **Tablet (1024–1919px):** Drawer collapses to overlay on top of list
- **Mobile (<1024px):** Drawer becomes full-width modal (not specified in MVP, defer)

---

## Animation & Transitions

- **Border color transition:** 0.15s ease (on card selection)
- **Modal appearance:** No fade-in (instant)
- **Drawer: appears/disappears instantly (no slide animation)

---

## Accessibility Notes

- All interactive elements have `cursor: pointer`
- Colors meet WCAG AA contrast requirements
- Skill IDs in monospace for scanning
- Section headers use uppercase + letter-spacing for visual hierarchy

---

## Future Enhancements

1. **Drag-to-reorder** skills within groups
2. **Bulk actions** (enable/disable multiple skills)
3. **Search bar** for skill name/description
4. **Skill tags/categories** for finer filtering
5. **Provider selection** toggle (filter by compatible providers)
6. **Sort options** (by runs, last used, alphabetical)
7. **Full-screen skill detail view** (from detail drawer)
8. **Compile preview** modal with dependency graph visualization
