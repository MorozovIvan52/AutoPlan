# CRM Platform — Design Direction

## Color System

### Default Theme: Dark Navy
- Background: `#0f1629`
- Sidebar: `#111827`
- Panel: `#1a2340`
- Card: `#1e2d4a`
- Border: `#2a3a5c`
- Accent: `#2563eb` (blue-600)
- Accent hover: `#1d4ed8`
- Text primary: `#f1f5f9`
- Text secondary: `#94a3b8`
- Success: `#10b981`
- Warning: `#f59e0b`
- Danger: `#ef4444`

### Theme Presets (5)
1. **Dark Navy** (default) — `#0f1629` bg, `#2563eb` accent
2. **Midnight** — `#0a0a0f` bg, `#7c3aed` accent (purple)
3. **Dark Teal** — `#0d1f1f` bg, `#0d9488` accent
4. **Light** — `#f8fafc` bg, `#2563eb` accent
5. **Telegram Gray** — `#efeff3` bg, `#2aabee` accent

## Typography
- **Display/Headings:** Poppins (600-700)
- **Body/UI:** Inter (400-500)
- Base size: 14px
- Line height: 1.5

## Layout
- Three-column layout (like Telegram Web):
  - Left: 280px sidebar (nav) + 320px conversation list
  - Center: flex-1 chat area
  - Right: 320px client panel (collapsible)
- Fixed header: 56px
- Mobile: single column with navigation

## Component Style
- Rounded corners: `rounded-lg` (8px) for cards, `rounded-full` for avatars/badges
- Shadows: subtle, colored (e.g. `shadow-blue-900/20`)
- Inputs: dark background, blue focus ring
- Buttons: filled primary (blue), ghost secondary
- Tags/badges: colored pills with soft background

## Motion
- Page transitions: fade-in 150ms
- Messages: slide-up from bottom
- Sidebar open/close: 200ms ease
- Notifications: slide-in from top-right

## Icons
- Library: `lucide-react`
- Size: 16px (ui), 20px (nav), 24px (actions)
