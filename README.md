# 📓 NoteVault v2

A beautiful, local-first personal knowledge base. Create **theory**, **code**, and **short** notes — all saved to a single `notes.json` file with zero backend.

> Built with vanilla HTML, CSS, and JavaScript. No frameworks, no build tools — just open and go.

---

## ✨ Features

### 📖 Three Note Types
- **Theory** — Long-form notes with full **Markdown** rendering (headings, bold, italic, lists, code blocks, tables, blockquotes)
- **Code** — Syntax-highlighted code snippets with language badges and one-click copy
- **Short** — Quick tips, facts, and reminders in a callout style

### ✍️ Slide-out Editor
- Side panel editor — see your notes while writing
- **Write / Preview tabs** for live Markdown preview (theory notes)
- Auto-resizing textarea that grows with your content
- Tab key inserts indentation in code mode
- Type selector pills with visual feedback

### 📖 Focus Reader Mode
- Click any note to enter an immersive, full-width reading view
- Enhanced typography — larger serif titles, generous line spacing
- **← Previous / Next →** navigation between notes
- Edit, Pin, and Delete actions from the reader toolbar
- Arrow keys (← →) to navigate, **E** to edit, **Esc** to exit

### 💾 Smart Saving
- **Auto-save** — changes persist automatically with a 2-second debounce
- **Visual save indicator** — color-coded dot in the top bar (🟢 Saved · 🟡 Unsaved · 🔵 Saving · 🔴 Error)
- **Undo delete** — 5-second toast with "Undo" button instead of blocking confirm dialogs
- File System Access API — link your `notes.json` once, handle stored in IndexedDB across sessions

### ⚡ Command Palette
- Press **Ctrl+K** to open a VS Code–style search palette
- Fuzzy search across all notes by title, content, and tags
- Quick actions: New Note, Open File, Save As
- Full keyboard navigation with ↑↓ and Enter

### 🔀 Drag-to-Reorder
- Drag notes to rearrange in "Original Sequence" sort mode
- Native HTML5 Drag & Drop — no libraries needed
- Order persists to `notes.json` immediately

### 🎨 Premium Design
- Dark theme with ambient gradient orbs
- Glassmorphism sidebar with backdrop blur
- Card-style notes with per-type accent colors (purple, green, amber)
- Staggered fade-in animations
- Smooth micro-interactions on hover and focus

---

## 🚀 Getting Started

### 1. Clone or download
```bash
git clone https://github.com/your-username/NoteVault.git
cd NoteVault
```

### 2. Serve locally
Use any static file server. The easiest options:

```bash
# VS Code Live Server (recommended)
# Install the "Live Server" extension, right-click index.html → Open with Live Server

# Or use Python
python -m http.server 5500

# Or use Node
npx serve .
```

### 3. Link your file
Click **Open File** in the sidebar and select (or create) a `notes.json` file. NoteVault will remember the file handle across page reloads.

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl + N` | New note |
| `Ctrl + K` | Command palette |
| `Ctrl + S` | Save to file |
| `Ctrl + F` | Focus search bar |
| `Esc` | Close editor → reader → sidebar |
| `← →` | Navigate notes (reader mode) |
| `E` | Edit current note (reader mode) |
| `Tab` | Indent (code editor) |

---

## 📁 Project Structure

```
NoteVault/
├── index.html      # App shell — markup, CDN scripts, structure
├── style.css       # Complete design system — dark theme, cards, editor, reader
├── app.js          # All logic — CRUD, editor, reader, auto-save, commands
├── notes.json      # Your data — portable, human-readable JSON
└── README.md       # This file
```

### Data Format (`notes.json`)
```json
{
  "version": 2,
  "notes": [
    {
      "id": "uuid",
      "type": "theory | code | short",
      "title": "Note Title",
      "content": "Markdown or plain text",
      "language": "python",
      "tags": ["tag1", "tag2"],
      "pinned": false,
      "createdAt": "2026-01-01T00:00:00.000Z",
      "updatedAt": "2026-01-01T00:00:00.000Z"
    }
  ]
}
```

---

## 🔧 Tech Stack

| Layer | Technology |
|-------|-----------|
| Structure | HTML5 |
| Styling | Vanilla CSS (custom properties, glassmorphism, animations) |
| Logic | Vanilla JavaScript (ES2020+) |
| Markdown | [marked.js](https://github.com/markedjs/marked) (CDN) |
| Syntax Highlighting | [highlight.js](https://highlightjs.org/) (CDN) |
| Fonts | [Inter](https://rsms.me/inter/), [Lora](https://fonts.google.com/specimen/Lora), [JetBrains Mono](https://www.jetbrains.com/lp/mono/) |
| Persistence | File System Access API + IndexedDB |

### Browser Compatibility
Requires **Chrome 86+** or **Edge 86+** (for File System Access API).
Firefox and Safari can read notes but cannot save — the "Open File" / "Save As" buttons won't work.

---

## 📝 License

MIT — free to use, modify, and distribute.
