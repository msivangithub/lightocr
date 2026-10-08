{
  "brand": {
    "product_name": "RetailCLIQ AI Document Wizard",
    "design_personality": [
      "enterprise ERP",
      "clean + operator-focused",
      "dense but scannable",
      "trustworthy + audit-friendly",
      "light-mode first"
    ],
    "north_star": "Make long OCR workflows feel controlled: clear step status, strong data hierarchy, fast review/mapping, and audit-ready outputs."
  },

  "design_tokens": {
    "notes": "Use CSS variables in index.css (:root) to override shadcn defaults. Keep light mode as primary. Brand blue must be #0f5fd6.",

    "css_custom_properties": {
      "color": {
        "--background": "210 33% 99%",
        "--foreground": "222 47% 11%",

        "--card": "0 0% 100%",
        "--card-foreground": "222 47% 11%",

        "--muted": "210 25% 96%",
        "--muted-foreground": "215 16% 35%",

        "--border": "214 20% 90%",
        "--input": "214 20% 90%",

        "--primary": "214 86% 45%",
        "--primary-foreground": "0 0% 100%",

        "--secondary": "210 25% 96%",
        "--secondary-foreground": "222 47% 11%",

        "--accent": "214 100% 97%",
        "--accent-foreground": "214 86% 35%",

        "--ring": "214 86% 45%",

        "--destructive": "0 84% 55%",
        "--destructive-foreground": "0 0% 100%",

        "--success": "142 71% 35%",
        "--warning": "32 95% 44%",
        "--info": "214 86% 45%",
        "--new-master": "270 67% 47%",

        "--surface-0": "210 33% 99%",
        "--surface-1": "0 0% 100%",
        "--surface-2": "210 25% 96%",

        "--shadow-color": "214 30% 20%"
      },

      "radius": {
        "--radius": "0.6rem",
        "--radius-sm": "0.45rem",
        "--radius-lg": "0.85rem"
      },

      "shadow": {
        "--shadow-sm": "0 1px 2px hsl(var(--shadow-color) / 0.06)",
        "--shadow-md": "0 10px 24px hsl(var(--shadow-color) / 0.10)",
        "--shadow-inset": "inset 0 1px 0 hsl(0 0% 100% / 0.7)"
      },

      "typography": {
        "--font-sans": "'IBM Plex Sans', ui-sans-serif, system-ui",
        "--font-mono": "'IBM Plex Mono', ui-monospace, SFMono-Regular",
        "--tracking-tight": "-0.02em"
      },

      "spacing": {
        "--space-1": "0.25rem",
        "--space-2": "0.5rem",
        "--space-3": "0.75rem",
        "--space-4": "1rem",
        "--space-5": "1.25rem",
        "--space-6": "1.5rem",
        "--space-8": "2rem",
        "--space-10": "2.5rem",
        "--space-12": "3rem"
      }
    },

    "tailwind_usage_notes": {
      "numeric_alignment": "Add `tabular-nums` to table containers; right-align numeric columns with `text-right`.",
      "dense_tables": "Prefer `text-xs sm:text-sm`, `leading-5`, `py-2` for compact rows; allow a density toggle later.",
      "focus": "Use visible focus rings: `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`."
    },

    "gradient_and_texture": {
      "allowed_usage": [
        "Only as a subtle hero/header background wash (<=20% viewport)",
        "Decorative top border / section header strip"
      ],
      "recommended_gradient": "background: radial-gradient(900px circle at 10% 0%, rgba(15,95,214,0.10), transparent 55%), radial-gradient(700px circle at 90% 10%, rgba(14,165,233,0.08), transparent 50%);",
      "noise_overlay": "Use a subtle CSS noise overlay on the app shell only (opacity 0.035–0.05). Avoid on tables for readability."
    }
  },

  "typography": {
    "font_pairing": {
      "heading_and_ui": "IBM Plex Sans (Google Fonts)",
      "mono_for_ids": "IBM Plex Mono (Google Fonts)",
      "why": "Plex reads like enterprise software, supports dense UI, and mono pairing improves scanability for invoice numbers, batch IDs, timestamps."
    },
    "text_size_hierarchy": {
      "h1": "text-4xl sm:text-5xl lg:text-6xl (use only on Result hero)",
      "h2": "text-base md:text-lg (wizard step titles/subtitles)",
      "body": "text-sm md:text-base",
      "small": "text-xs text-muted-foreground",
      "table": "text-xs sm:text-sm with tabular-nums"
    },
    "type_rules": [
      "Use `tracking-[-0.02em]` for headings only.",
      "Use `font-medium` for labels; `font-semibold` for section titles.",
      "Use mono for: batch id, doc id, invoice no, PO no, GSTIN, timestamps."
    ]
  },

  "layout_and_grid": {
    "app_shell": {
      "structure": "Top header (sticky) + left stepper rail (desktop) + main content + optional right inspector panel.",
      "max_width": "Use full-width for tables; constrain text-only sections to max-w-5xl.",
      "page_padding": "px-3 sm:px-5 lg:px-6; vertical spacing: py-4 sm:py-6",
      "background": "Use surface-0 for app background; cards on surface-1; toolbars on surface-2."
    },
    "responsive": {
      "mobile_390": "Stepper becomes horizontal scrollable bar; split panes become stacked with a resizable drawer for preview.",
      "desktop": "Use `ResizablePanelGroup` for Review step: left preview 45% / right data 55% with min sizes."
    },
    "dense_data_principles": [
      "Prefer split layouts over modals for review/mapping.",
      "Keep primary actions in a sticky footer bar within the step content.",
      "Use section headers with counts (e.g., Issues: 12) and quick filters."
    ]
  },

  "components": {
    "component_path": {
      "shadcn_ui": {
        "button": "/app/frontend/src/components/ui/button.jsx",
        "badge": "/app/frontend/src/components/ui/badge.jsx",
        "card": "/app/frontend/src/components/ui/card.jsx",
        "tabs": "/app/frontend/src/components/ui/tabs.jsx",
        "table": "/app/frontend/src/components/ui/table.jsx",
        "input": "/app/frontend/src/components/ui/input.jsx",
        "textarea": "/app/frontend/src/components/ui/textarea.jsx",
        "select": "/app/frontend/src/components/ui/select.jsx",
        "checkbox": "/app/frontend/src/components/ui/checkbox.jsx",
        "radio_group": "/app/frontend/src/components/ui/radio-group.jsx",
        "progress": "/app/frontend/src/components/ui/progress.jsx",
        "scroll_area": "/app/frontend/src/components/ui/scroll-area.jsx",
        "separator": "/app/frontend/src/components/ui/separator.jsx",
        "tooltip": "/app/frontend/src/components/ui/tooltip.jsx",
        "dialog": "/app/frontend/src/components/ui/dialog.jsx",
        "sheet_drawer": "/app/frontend/src/components/ui/sheet.jsx",
        "resizable": "/app/frontend/src/components/ui/resizable.jsx",
        "collapsible": "/app/frontend/src/components/ui/collapsible.jsx",
        "sonner_toast": "/app/frontend/src/components/ui/sonner.jsx",
        "skeleton": "/app/frontend/src/components/ui/skeleton.jsx",
        "calendar": "/app/frontend/src/components/ui/calendar.jsx"
      }
    },

    "wizard_stepper": {
      "pattern": "ERP-style step rail with status dots + labels + substatus (e.g., '3 warnings').",
      "desktop": "Left vertical rail inside a Card; each step row is clickable with hover highlight; active step has blue left border.",
      "mobile": "Top horizontal stepper with scroll + compact labels; show current step title below.",
      "step_states": {
        "pending": "muted text + hollow dot",
        "active": "brand blue dot + subtle blue background tint",
        "complete": "green dot + check icon",
        "blocked": "red dot + exclamation"
      },
      "micro_interactions": [
        "On step change: content cross-fade (150–200ms) + scroll to top.",
        "Hover on step: background tint `bg-accent/60` and left indicator appears.",
        "Keyboard: arrow up/down to move steps; Enter to activate (add data-testid on step buttons)."
      ]
    },

    "header": {
      "structure": "Sticky top bar with: RetailCLIQ logo/wordmark, current batch id, doc type chip, global search, user menu.",
      "style": "Light surface with bottom border; avoid heavy shadows.",
      "elements": [
        "Batch pill (mono) with copy button",
        "Connection/ERP status indicator (Badge)",
        "Primary CTA: 'Post to ERP' appears only on POST step"
      ]
    },

    "source_step": {
      "layout": "Two-column on desktop: left = source type tiles (2x3 grid), right = upload zone + recent files.",
      "source_tiles": "Use Card with icon + title + helper text; selected tile gets blue ring.",
      "upload_zone": "Large dashed border dropzone; show file constraints; show queue list with per-file progress.",
      "data_testid_examples": [
        "source-type-tile-email",
        "source-upload-dropzone",
        "source-upload-browse-button",
        "source-upload-queue-item"
      ]
    },

    "detect_step": {
      "layout": "Card with detected doc type, confidence bar, and alternatives list.",
      "confidence": "Use Progress + numeric percent; color shifts: >90 blue, 70–90 warning, <70 red.",
      "alternatives": "RadioGroup list with doc type + confidence; selecting updates downstream mapping templates."
    },

    "extract_step_progress": {
      "layout": "Split: left = pipeline visualization (10-step mini timeline), right = live log + progress.",
      "progress": "Use Progress component; show ETA and elapsed time; keep log in ScrollArea.",
      "log_style": "Monospace, small, with level badges (INFO/WARN/ERROR).",
      "micro_interactions": [
        "Auto-scroll log with 'Pause' toggle.",
        "When a pipeline stage completes: subtle pulse on stage dot (not global transitions)."
      ]
    },

    "review_step": {
      "layout": "Resizable split pane: left document preview, right extracted data (header fields + line items).",
      "left_preview": {
        "viewer": "Use AspectRatio container; toolbar: zoom in/out, rotate, fit width, highlight OCR boxes toggle.",
        "mobile": "Preview opens in Sheet (drawer) with sticky toolbar; default shows data first."
      },
      "right_data": {
        "sections": [
          "Header fields (2-column form grid)",
          "Line items table (dense, editable)",
          "Totals summary bar (sticky at bottom of table)"
        ],
        "inline_editing": "Single-cell edit on click; show Input with blue focus ring; Enter saves cell, Esc cancels; show dirty indicator dot.",
        "table_rules": [
          "Numeric columns right-aligned",
          "Use `tabular-nums`",
          "Sticky header row",
          "Row hover highlight `bg-muted/60`",
          "Selected row tint `bg-accent`"
        ]
      }
    },

    "map_step": {
      "layout": "Tabbed mapping console: Supplier | Items | UOM | Taxes. Each tab has a table + right-side 'Resolution' panel.",
      "resolution_panel": "Use Card with suggested matches, confidence, and 'Create new master' CTA.",
      "badges": "Use semantic badges for match status: matched, ambiguous, missing, new-master."
    },

    "validate_step": {
      "layout": "Three-column on desktop: left = issue filters, middle = issue list, right = context panel (field + suggested fix).",
      "issue_levels": {
        "error": "red",
        "warning": "orange",
        "new-master": "purple",
        "info": "blue",
        "ok": "green"
      },
      "interaction": "Clicking an issue focuses the corresponding field in Review/Map (deep-link within wizard state)."
    },

    "reconcile_step": {
      "layout": "Checks table with columns: Check | Expected | Extracted | Diff | Status.",
      "diff_column": "Use mono + right align; highlight non-zero diffs with subtle red background tint.",
      "empty_state": "If no diffs: show success Card with next action CTA."
    },

    "post_step": {
      "layout": "Posting plan list (transactions) + confirmation panel.",
      "confirmation": "Require checkbox 'I confirm' + show ERP target company/store; then enable Post button.",
      "safety": "Show irreversible warning in Alert component."
    },

    "result_step": {
      "layout": "Hero status card + audit trail timeline + payload viewer link.",
      "hero": "Large Card with status badge, posted doc numbers, and 'Download JSON/CSV' actions.",
      "audit_trail": "Use Table or vertical list with timestamps (mono) and event badges."
    },

    "bulk_inbox": {
      "layout": "Grid of document cards with status badges + quick actions; include filters row.",
      "card": "Show doc thumbnail placeholder, supplier, amount, date, status, and step last completed.",
      "performance": "Use pagination; avoid rendering huge grids at once."
    },

    "erp_payload_viewer": {
      "layout": "Two tabs: Header (key-value table) | Items (grid).",
      "kv_style": "Key column muted, value column mono; copy buttons per row.",
      "json_view": "Optional collapsible raw JSON panel with monospace + line wrap toggle."
    }
  },

  "motion_and_microinteractions": {
    "principles": [
      "Motion communicates state changes (step transitions, save success, validation focus).",
      "Keep durations short: 120–220ms; easing: `cubic-bezier(0.2, 0.8, 0.2, 1)`.",
      "Never use `transition: all`. Only transition color, background-color, border-color, box-shadow, opacity."
    ],
    "recommended_library": {
      "name": "framer-motion",
      "install": "npm i framer-motion",
      "usage": "Use for step content transitions, subtle list entrance for logs/issues, and toast-like confirmations (still use sonner for toasts)."
    },
    "interaction_specs": {
      "buttons": "Hover: bg tint + shadow-sm; Active: scale 0.98; Focus: ring.",
      "table_rows": "Hover: background tint; Selected: persistent tint + left border indicator.",
      "saving": "On cell save: show tiny checkmark fade-in near cell for 800ms; on error: shake 6px (one-time) + error message."
    }
  },

  "data_display_rules": {
    "numbers": [
      "Always right-align numeric columns.",
      "Use `tabular-nums` and consistent decimal formatting.",
      "Show currency with INR symbol where relevant; keep symbol muted."
    ],
    "badges": {
      "ok": "green",
      "error": "red",
      "warning": "orange",
      "new-master": "purple",
      "info": "blue",
      "badge_text": "Always include text label (not color-only)."
    },
    "logs": "Use monospace; include timestamp; allow copy/export."
  },

  "accessibility": {
    "requirements": [
      "WCAG AA contrast for text and interactive elements.",
      "All interactive elements must have visible focus state.",
      "Do not rely on color alone for status; include label + icon.",
      "Respect prefers-reduced-motion: disable pulses and entrance animations."
    ],
    "keyboard": [
      "Stepper navigable via keyboard.",
      "Tables: Enter to edit, Esc to cancel, Ctrl+Enter to save row (optional)."
    ]
  },

  "testing_attributes": {
    "rule": "All interactive and key informational elements MUST include data-testid (kebab-case, role-based).",
    "examples": [
      "wizard-stepper-step-source",
      "wizard-next-button",
      "wizard-back-button",
      "review-line-items-table",
      "review-line-item-cell-qty-input",
      "validation-issue-list",
      "validation-issue-filter-error",
      "post-to-erp-submit-button",
      "result-status-badge",
      "bulk-inbox-filter-status-select"
    ]
  },

  "image_urls": [
    {
      "category": "result_step_hero_side_image_optional",
      "description": "Subtle contextual image for Result hero card (optional). Keep low-contrast, do not distract from data.",
      "url": "https://images.unsplash.com/photo-1705846973668-0e9ed382ea8f?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA1Mjh8MHwxfHNlYXJjaHwxfHxvZmZpY2UlMjBwYXBlcndvcmslMjBpbnZvaWNlJTIwY2xvc2V1cHxlbnwwfHx8dGVhbHwxNzkxMTk2NTE4fDA&ixlib=rb-4.1.0&q=85"
    }
  ],

  "instructions_to_main_agent": [
    "Update /app/frontend/src/App.css to remove CRA demo styles; do NOT center align the app container.",
    "Update /app/frontend/src/index.css :root tokens to match the palette above; keep light mode default.",
    "Use shadcn components from /app/frontend/src/components/ui (JS imports). Avoid native HTML dropdown/calendar/toast.",
    "Implement the wizard as a single-page layout with a step rail + content area; use Resizable panels for Review.",
    "Ensure all tables use `tabular-nums` and numeric columns are `text-right`.",
    "Use Sonner for toasts; include data-testid on all interactive and key informational elements.",
    "Keep gradients minimal and only in header/hero wash (<=20% viewport)."
  ]
}

<General UI UX Design Guidelines>  
    - You must **not** apply universal transition. Eg: `transition: all`. This results in breaking transforms. Always add transitions for specific interactive elements like button, input excluding transforms
    - You must **not** center align the app container, ie do not add `.App { text-align: center; }` in the css file. This disrupts the human natural reading flow of text
   - NEVER: use AI assistant Emoji characters like`🤖🧠💭💡🔮🎯📚🎭🎬🎪🎉🎊🎁🎀🎂🍰🎈🎨🎰💰💵💳🏦💎🪙💸🤑📊📈📉💹🔢🏆🥇 etc for icons. Always use **FontAwesome cdn** or **lucid-react** library already installed in the package.json

 **GRADIENT RESTRICTION RULE**
NEVER use dark/saturated gradient combos (e.g., purple/pink) on any UI element.  Prohibited gradients: blue-500 to purple 600, purple 500 to pink-500, green-500 to blue-500, red to pink etc
NEVER use dark gradients for logo, testimonial, footer etc
NEVER let gradients cover more than 20% of the viewport.
NEVER apply gradients to text-heavy content or reading areas.
NEVER use gradients on small UI elements (<100px width).
NEVER stack multiple gradient layers in the same viewport.

**ENFORCEMENT RULE:**
    • Id gradient area exceeds 20% of viewport OR affects readability, **THEN** use solid colors

**How and where to use:**
   • Section backgrounds (not content backgrounds)
   • Hero section header content. Eg: dark to light to dark color
   • Decorative overlays and accent elements only
   • Hero section with 2-3 mild color
   • Gradients creation can be done for any angle say horizontal, vertical or diagonal

- For AI chat, voice application, **do not use purple color. Use color like light green, ocean blue, peach orange etc**

</Font Guidelines>

- Every interaction needs micro-animations - hover states, transitions, parallax effects, and entrance animations. Static = dead. 
   
- Use 2-3x more spacing than feels comfortable. Cramped designs look cheap.

- Subtle grain textures, noise overlays, custom cursors, selection states, and loading animations: separates good from extraordinary.
   
- Before generating UI, infer the visual style from the problem statement (palette, contrast, mood, motion) and immediately instantiate it by setting global design tokens (primary, secondary/accent, background, foreground, ring, state colors), rather than relying on any library defaults. Don't make the background dark as a default step, always understand problem first and define colors accordingly
    Eg: - if it implies playful/energetic, choose a colorful scheme
           - if it implies monochrome/minimal, choose a black–white/neutral scheme

**Component Reuse:**
	- Prioritize using pre-existing components from src/components/ui when applicable
	- Create new components that match the style and conventions of existing components when needed
	- Examine existing components to understand the project's component patterns before creating new ones

**IMPORTANT**: Do not use HTML based component like dropdown, calendar, toast etc. You **MUST** always use `/app/frontend/src/components/ui/ ` only as a primary components as these are modern and stylish component

**Best Practices:**
	- Use Shadcn/UI as the primary component library for consistency and accessibility
	- Import path: ./components/[component-name]

**Export Conventions:**
	- Components MUST use named exports (export const ComponentName = ...)
	- Pages MUST use default exports (export default function PageName() {...})

**Toasts:**
  - Use `sonner` for toasts"
  - Sonner component are located in `/app/src/components/ui/sonner.tsx`

Use 2–4 color gradients, subtle textures/noise overlays, or CSS-based noise to avoid flat visuals.
</General UI UX Design Guidelines>
