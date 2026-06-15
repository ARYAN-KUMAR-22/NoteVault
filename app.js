/**
 * NoteVault — App Logic (Book Layout Edition)
 * ============================================
 * - Sequential book/document layout
 * - Theory: full-width, document style
 * - Code: centered code-block with syntax highlight
 * - Short: callout/aside style
 *
 * PERSISTENCE STRATEGY:
 *   READ  → fetch('./notes.json') on every page load (works on localhost / Live Server)
 *   WRITE → File System Access API; user links notes.json once, handle stored in IndexedDB
 *   NO localStorage — everything lives in notes.json
 */

'use strict';

// ============================================================
// STATE
// ============================================================
const State = {
  notes:        [],       // ordered array of note objects
  fileHandle:   null,     // FileSystemFileHandle (FS Access API)
  activeFilter: 'all',
  searchQuery:  '',
  sortOrder:    'sequence',
  editingId:    null,
  activeType:   'theory',
  sidebarOpen:  false,
};

// ============================================================
// INDEXEDDB — persist file handle across page reloads
// ============================================================
const IDB_NAME    = 'notevault_db';
const IDB_STORE   = 'handles';
const IDB_KEY     = 'notes_file_handle';
const IDB_VERSION = 1;

function openIDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = e => e.target.result.createObjectStore(IDB_STORE);
    req.onsuccess  = e => resolve(e.target.result);
    req.onerror    = e => reject(e.target.error);
  });
}

async function saveHandleToIDB(handle) {
  try {
    const db    = await openIDB();
    const tx    = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(handle, IDB_KEY);
    await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = rej; });
  } catch (e) { console.warn('IDB save error:', e); }
}

async function loadHandleFromIDB() {
  try {
    const db = await openIDB();
    return new Promise((resolve) => {
      const tx  = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(IDB_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror   = () => resolve(null);
    });
  } catch { return null; }
}

async function clearHandleFromIDB() {
  try {
    const db = await openIDB();
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).delete(IDB_KEY);
  } catch {}
}

// ============================================================
// DOM REFERENCES
// ============================================================
const $ = id => document.getElementById(id);

const DOM = {
  bookDocument:   $('bookDocument'),
  emptyState:     $('emptyState'),
  noResultsState: $('noResultsState'),
  bookTopTitle:   $('bookTopTitle'),
  noteSeqInfo:    $('noteSeqInfo'),
  saveIndicator:  $('saveIndicator'),
  // Sidebar
  sidebarFileBox: $('sidebarFileBox'),
  fileBoxName:    $('fileBoxName'),
  fileBoxSub:     $('fileBoxSub'),
  newNoteBtn:     $('newNoteBtn'),
  searchInput:    $('searchInput'),
  searchClear:    $('searchClear'),
  sortSelect:     $('sortSelect'),
  openFileBtn:    $('openFileBtn'),
  exportBtn:      $('exportBtn'),
  sidebar:        $('sidebar'),
  sidebarToggle:  $('sidebarToggle'),
  // Counts
  countAll:    $('countAll'),
  countTheory: $('countTheory'),
  countCode:   $('countCode'),
  countShort:  $('countShort'),
  countPinned: $('countPinned'),
  // Nav items
  navItems: document.querySelectorAll('.nav-item'),
  // Modal
  modalOverlay: $('modalOverlay'),
  modalTitle:   $('modalTitle'),
  modalClose:   $('modalClose'),
  cancelBtn:    $('cancelBtn'),
  saveNoteBtn:  $('saveNoteBtn'),
  typePills:    document.querySelectorAll('.type-pill'),
  noteTitle:    $('noteTitle'),
  noteContent:  $('noteContent'),
  noteTags:     $('noteTags'),
  pinToggle:    $('pinToggle'),
  langRow:      $('langRow'),
  langSelect:   $('langSelect'),
  // Status
  fileStatus:   $('fileStatus'),
  lastSaved:    $('lastSaved'),
  toastContainer: $('toastContainer'),
};

// ============================================================
// UTILITIES
// ============================================================
function uuid() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
      });
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-IN', {
    day:'2-digit', month:'short', year:'numeric',
    hour:'2-digit', minute:'2-digit'
  });
}

function timeAgo(iso) {
  if (!iso) return '';
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60)  return 'just now';
  const m = Math.floor(s/60); if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m/60); if (h < 24)  return `${h}h ago`;
  const d = Math.floor(h/24); if (d < 30)  return `${d}d ago`;
  return formatDate(iso);
}

function parseTags(raw) {
  return (raw || '').split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
}

// ============================================================
// TOAST
// ============================================================
function showToast(msg, type = 'info', ms = 3000) {
  const icons = { success:'✅', error:'❌', info:'ℹ️' };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${icons[type]||''}</span><span>${escapeHtml(msg)}</span>`;
  DOM.toastContainer.appendChild(el);
  setTimeout(() => {
    el.style.animation = 'tOut 0.3s ease forwards';
    setTimeout(() => el.remove(), 300);
  }, ms);
}

// ============================================================
// PERSISTENCE — JSON FILE ONLY (no localStorage)
// ============================================================

function buildPayload() {
  return JSON.stringify({ version: 2, notes: State.notes }, null, 2);
}

async function writeToFileHandle(handle, payload) {
  const writable = await handle.createWritable();
  await writable.write(payload);
  await writable.close();
}

/**
 * persistNotes — write State.notes back to notes.json via File System API.
 * If no handle is linked yet, prompt the user to pick the file first.
 */
async function persistNotes() {
  const payload = buildPayload();

  if (!State.fileHandle) {
    // No file linked — ask user to link notes.json now
    showToast('Link your notes.json first! Click "Open File" or the file box.', 'error', 5000);
    return;
  }

  try {
    let perm = await State.fileHandle.queryPermission({ mode: 'readwrite' });
    if (perm !== 'granted') {
      perm = await State.fileHandle.requestPermission({ mode: 'readwrite' });
    }
    if (perm === 'granted') {
      await writeToFileHandle(State.fileHandle, payload);
      showSaveIndicator('✅ Saved to notes.json');
      DOM.lastSaved.textContent = `Saved at ${new Date().toLocaleTimeString()}`;
    } else {
      showToast('Write permission denied for notes.json.', 'error');
    }
  } catch (err) {
    console.error('File write error:', err);
    showToast('Failed to write to notes.json!', 'error');
  }
}

function showSaveIndicator(text) {
  DOM.saveIndicator.textContent = text;
  setTimeout(() => { DOM.saveIndicator.textContent = ''; }, 3000);
}

function setFileUI(name, sub) {
  DOM.fileBoxName.textContent = name;
  DOM.fileBoxSub.textContent  = sub;
  DOM.fileStatus.textContent  = State.fileHandle
    ? `📄 ${name} — all changes saved to file`
    : '⚠️ No file linked — click "Open File" to link notes.json';
}

// ============================================================
// LOAD NOTES — on startup
// ============================================================
/**
 * Strategy:
 *   1. fetch('./notes.json') — reads directly from the served file (always works on localhost)
 *   2. Also restore the write handle from IndexedDB so saves go back to the same file
 */
async function loadNotesOnStartup() {
  // Step 1: Read notes.json via HTTP (fetch) — no user interaction needed
  try {
    const res = await fetch('./notes.json', { cache: 'no-store' });
    if (res.ok) {
      const text = await res.text();
      if (text.trim()) {
        const parsed = JSON.parse(text);
        State.notes = Array.isArray(parsed) ? parsed : (parsed.notes || []);
      }
    }
  } catch (err) {
    console.warn('Could not fetch notes.json:', err);
  }

  // Step 2: Restore file handle from IndexedDB for writing
  const handle = await loadHandleFromIDB();
  if (handle) {
    try {
      // Check if we still have permission (may need to re-request after page reload)
      let perm = await handle.queryPermission({ mode: 'readwrite' });
      if (perm === 'granted') {
        State.fileHandle = handle;
        setFileUI(handle.name, `Linked • ${State.notes.length} notes loaded`);
      } else if (perm === 'prompt') {
        // Store handle but don't auto-request — will request on first save
        State.fileHandle = handle;
        setFileUI(handle.name, `Linked (permission needed on first save)`);
      }
    } catch {
      // Stale handle — clear it
      await clearHandleFromIDB();
      setFileUI('notes.json', `${State.notes.length} notes (read-only until you re-link)`);
    }
  } else {
    // No handle stored — show prompt to link
    if (State.notes.length > 0) {
      setFileUI('notes.json', `${State.notes.length} notes loaded — link file to enable saving`);
      DOM.fileStatus.textContent = '⚠️ Read-only: click "Open File" to enable saving to notes.json';
    } else {
      setFileUI('notes.json', 'Empty — link file to start saving');
      DOM.fileStatus.textContent = '⚠️ Click "Open File" and select your notes.json to link it for saving';
    }
  }

  renderDocument();

  if (State.notes.length > 0 && State.fileHandle) {
    showToast(`Loaded ${State.notes.length} notes from notes.json`, 'success');
  }
}

// ============================================================
// OPEN FILE (user-initiated) — links notes.json for writing
// ============================================================
async function openFile() {
  if (!('showOpenFilePicker' in window)) {
    showToast('File System API not supported. Use Chrome or Edge.', 'error');
    return;
  }
  try {
    const [handle] = await window.showOpenFilePicker({
      types: [{ description: 'JSON Files', accept: { 'application/json': ['.json'] } }],
      multiple: false,
    });

    // Read the file content
    const file   = await handle.getFile();
    const text   = await file.text();
    if (text.trim()) {
      const parsed = JSON.parse(text);
      State.notes = Array.isArray(parsed) ? parsed : (parsed.notes || []);
    }

    State.fileHandle = handle;
    await saveHandleToIDB(handle);
    setFileUI(handle.name, `${State.notes.length} notes loaded`);
    renderDocument();
    showToast(`Linked ${handle.name} — ${State.notes.length} notes`, 'success');
  } catch (err) {
    if (err.name !== 'AbortError') showToast('Could not open file.', 'error');
  }
}

// ============================================================
// SAVE FILE AS — explicit Save As (also links the new file)
// ============================================================
async function saveFile() {
  if (!('showSaveFilePicker' in window)) {
    showToast('File System API not supported. Use Chrome or Edge.', 'error');
    return;
  }
  try {
    const handle = await window.showSaveFilePicker({
      suggestedName: 'notes.json',
      types: [{ description: 'JSON Files', accept: { 'application/json': ['.json'] } }],
    });
    await writeToFileHandle(handle, buildPayload());
    State.fileHandle = handle;
    await saveHandleToIDB(handle);
    setFileUI(handle.name, `Saved • ${State.notes.length} notes`);
    showToast(`Saved to ${handle.name}`, 'success');
  } catch (err) {
    if (err.name !== 'AbortError') showToast('Save failed.', 'error');
  }
}

// ============================================================
// CRUD
// ============================================================
function createNote({ type, title, content, language, tags, pinned }) {
  return {
    id:        uuid(),
    type:      type || 'theory',
    title:     title.trim() || 'Untitled',
    content:   content.trim(),
    language:  language || null,
    tags:      parseTags(tags),
    pinned:    !!pinned,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function saveNote() {
  const title    = DOM.noteTitle.value;
  const content  = DOM.noteContent.value.trim();
  const tags     = DOM.noteTags.value;
  const pinned   = DOM.pinToggle.checked;
  const type     = State.activeType;
  const language = type === 'code' ? DOM.langSelect.value : null;

  if (!content && !title.trim()) {
    showToast('Add a title or some content!', 'error');
    DOM.noteTitle.focus();
    return;
  }

  if (State.editingId) {
    const idx = State.notes.findIndex(n => n.id === State.editingId);
    if (idx !== -1) {
      State.notes[idx] = {
        ...State.notes[idx],
        type, title: title.trim() || 'Untitled', content, language,
        tags: parseTags(tags), pinned,
        updatedAt: new Date().toISOString(),
      };
      showToast('Note updated!', 'success');
    }
  } else {
    // Add new note at the END (sequential / book order)
    State.notes.push(createNote({ type, title, content, language, tags, pinned }));
    showToast('Note added to your notebook!', 'success');
  }

  persistNotes();
  closeModal();
  renderDocument();

  // Scroll to bottom to show new note
  if (!State.editingId) {
    setTimeout(() => {
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    }, 100);
  }
}

function deleteNote(id) {
  if (!confirm('Delete this note? This cannot be undone.')) return;
  State.notes = State.notes.filter(n => n.id !== id);
  persistNotes();
  renderDocument();
  showToast('Note deleted.', 'info');
}

function togglePin(id) {
  const note = State.notes.find(n => n.id === id);
  if (!note) return;
  note.pinned = !note.pinned;
  note.updatedAt = new Date().toISOString();
  persistNotes();
  renderDocument();
  showToast(note.pinned ? 'Note pinned 📌' : 'Note unpinned', 'info');
}

// ============================================================
// MODAL
// ============================================================
function openAddModal() {
  State.editingId = null;
  DOM.modalTitle.textContent = 'New Note';
  DOM.saveNoteBtn.textContent = 'Save Note';
  resetForm();
  setActiveType('theory');
  showModal();
  setTimeout(() => DOM.noteTitle.focus(), 60);
}

function openEditModal(id) {
  const note = State.notes.find(n => n.id === id);
  if (!note) return;
  State.editingId = id;
  DOM.modalTitle.textContent = 'Edit Note';
  DOM.saveNoteBtn.textContent = 'Update Note';
  setActiveType(note.type);
  DOM.noteTitle.value   = note.title;
  DOM.noteContent.value = note.content;
  DOM.noteTags.value    = note.tags.join(', ');
  DOM.pinToggle.checked = note.pinned;
  if (note.type === 'code' && note.language) DOM.langSelect.value = note.language;
  showModal();
  setTimeout(() => DOM.noteTitle.focus(), 60);
}

function showModal() {
  DOM.modalOverlay.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  DOM.modalOverlay.style.display = 'none';
  document.body.style.overflow = '';
  State.editingId = null;
  resetForm();
}

function resetForm() {
  DOM.noteTitle.value   = '';
  DOM.noteContent.value = '';
  DOM.noteTags.value    = '';
  DOM.pinToggle.checked = false;
  DOM.langSelect.value  = 'python';
  DOM.noteContent.classList.remove('code-mode');
}

// ============================================================
// TYPE SELECTOR
// ============================================================
function setActiveType(type) {
  State.activeType = type;
  DOM.typePills.forEach(p => p.classList.toggle('active', p.dataset.type === type));
  DOM.langRow.style.display = type === 'code' ? 'block' : 'none';

  if (type === 'code') {
    DOM.noteContent.classList.add('code-mode');
    DOM.noteContent.placeholder = 'Write your code here…';
    DOM.noteContent.rows = 16;
  } else if (type === 'short') {
    DOM.noteContent.classList.remove('code-mode');
    DOM.noteContent.placeholder = 'Quick tip, fact, or reminder…';
    DOM.noteContent.rows = 5;
  } else {
    DOM.noteContent.classList.remove('code-mode');
    DOM.noteContent.placeholder = 'Write your theory, explanation, or notes here…';
    DOM.noteContent.rows = 12;
  }
}

// ============================================================
// FILTER & SORT
// ============================================================
function getDisplayNotes() {
  let notes = [...State.notes];

  if (State.activeFilter === 'pinned') {
    notes = notes.filter(n => n.pinned);
  } else if (State.activeFilter !== 'all') {
    notes = notes.filter(n => n.type === State.activeFilter);
  }

  if (State.searchQuery) {
    const q = State.searchQuery.toLowerCase();
    notes = notes.filter(n =>
      n.title.toLowerCase().includes(q) ||
      n.content.toLowerCase().includes(q) ||
      n.tags.some(t => t.includes(q))
    );
  }

  // Sort — 'sequence' preserves original array order
  if (State.sortOrder !== 'sequence') {
    notes.sort((a, b) => {
      switch (State.sortOrder) {
        case 'newest':  return new Date(b.createdAt) - new Date(a.createdAt);
        case 'oldest':  return new Date(a.createdAt) - new Date(b.createdAt);
        case 'title':   return a.title.localeCompare(b.title);
        case 'updated': return new Date(b.updatedAt) - new Date(a.updatedAt);
        default: return 0;
      }
    });
  }

  return notes;
}

// ============================================================
// RENDER — THEORY NOTE
// ============================================================
function renderTheory(note) {
  const pinFlag = note.pinned
    ? `<div class="theory-pin-flag">📌 Pinned</div>` : '';
  const tagsHtml = note.tags.length
    ? `<div class="theory-tags">${note.tags.map(t => `<span class="theory-tag">#${escapeHtml(t)}</span>`).join('')}</div>`
    : '';
  return `
    <div class="note-theory" data-id="${note.id}">
      ${pinFlag}
      <h2 class="theory-title">${escapeHtml(note.title)}</h2>
      ${tagsHtml}
      <div class="theory-body">${escapeHtml(note.content)}</div>
      <div class="theory-meta">
        <span>📖 Theory</span>
        <span>${formatDate(note.createdAt)}</span>
        ${note.updatedAt !== note.createdAt ? `<span>Updated ${timeAgo(note.updatedAt)}</span>` : ''}
      </div>
    </div>
  `;
}

// ============================================================
// RENDER — CODE NOTE
// ============================================================
function renderCode(note) {
  const lang = note.language || 'plaintext';
  let highlighted;
  try {
    highlighted = hljs.getLanguage(lang)
      ? hljs.highlight(note.content, { language: lang }).value
      : escapeHtml(note.content);
  } catch {
    highlighted = escapeHtml(note.content);
  }

  const tagsHtml = note.tags.length
    ? `<div class="code-note-tags">${note.tags.map(t => `<span class="code-note-tag">#${escapeHtml(t)}</span>`).join('')}</div>`
    : '';

  const pinFlag = note.pinned ? ' 📌' : '';

  return `
    <div class="note-code" data-id="${note.id}">
      <div class="code-note-title">${escapeHtml(note.title)}${pinFlag}</div>
      <div class="code-block-wrap">
        <div class="code-block-header">
          <div class="code-block-dots">
            <span class="code-dot code-dot-r"></span>
            <span class="code-dot code-dot-y"></span>
            <span class="code-dot code-dot-g"></span>
          </div>
          <span class="code-lang-badge">${escapeHtml(lang)}</span>
          <button class="copy-btn" data-copy="${note.id}" title="Copy code">Copy</button>
        </div>
        <div class="code-block-body">
          <pre><code class="hljs language-${lang}" data-raw="${note.id}">${highlighted}</code></pre>
        </div>
      </div>
      ${tagsHtml}
      <div class="code-note-meta">
        <span>💻 Code</span>
        <span>${formatDate(note.createdAt)}</span>
      </div>
    </div>
  `;
}

// ============================================================
// RENDER — SHORT NOTE
// ============================================================
function renderShort(note) {
  const tagsHtml = note.tags.length
    ? `<div class="short-tags">${note.tags.map(t => `<span class="short-tag">#${escapeHtml(t)}</span>`).join('')}</div>`
    : '';
  const pinIcon = note.pinned ? '📌' : '⚡';
  return `
    <div class="note-short" data-id="${note.id}">
      <div class="short-callout">
        <span class="short-icon">${pinIcon}</span>
        <div class="short-inner">
          <div class="short-title">${escapeHtml(note.title)}</div>
          <div class="short-body">${escapeHtml(note.content)}</div>
          <div class="short-footer">
            ${tagsHtml}
            <span class="short-date">${timeAgo(note.createdAt)}</span>
          </div>
        </div>
      </div>
    </div>
  `;
}

// ============================================================
// RENDER — FULL DOCUMENT
// ============================================================
function renderDocument() {
  updateCounts();
  const notes = getDisplayNotes();
  const filterLabel = {
    all: 'All Notes', theory: 'Theory Notes',
    code: 'Code Snippets', short: 'Short Notes', pinned: 'Pinned Notes'
  };
  DOM.bookTopTitle.textContent = filterLabel[State.activeFilter] || 'Notes';
  DOM.noteSeqInfo.textContent  = notes.length > 0
    ? `${notes.length} note${notes.length !== 1 ? 's' : ''}`
    : '';

  if (State.notes.length === 0) {
    DOM.bookDocument.innerHTML = '';
    DOM.emptyState.style.display   = 'flex';
    DOM.noResultsState.style.display = 'none';
    return;
  }
  DOM.emptyState.style.display = 'none';

  if (notes.length === 0) {
    DOM.bookDocument.innerHTML = '';
    DOM.noResultsState.style.display = 'flex';
    return;
  }
  DOM.noResultsState.style.display = 'none';

  const fragments = notes.map((note, idx) => {
    let inner = '';
    if      (note.type === 'theory') inner = renderTheory(note);
    else if (note.type === 'code')   inner = renderCode(note);
    else                             inner = renderShort(note);

    const sep = idx < notes.length - 1 ? '<div class="note-separator"></div>' : '';

    return `
      <div class="note-entry" data-id="${note.id}">
        <div class="entry-actions">
          <button class="entry-btn pin${note.pinned ? ' active' : ''}"
            data-action="pin" data-id="${note.id}"
            title="${note.pinned ? 'Unpin' : 'Pin'}">📌</button>
          <button class="entry-btn"
            data-action="edit" data-id="${note.id}" title="Edit">✏️</button>
          <button class="entry-btn del"
            data-action="delete" data-id="${note.id}" title="Delete">🗑️</button>
        </div>
        ${inner}
      </div>
      ${sep}
    `;
  });

  DOM.bookDocument.innerHTML = fragments.join('');
  attachBookListeners();
}

function updateCounts() {
  const all    = State.notes.length;
  const theory = State.notes.filter(n => n.type === 'theory').length;
  const code   = State.notes.filter(n => n.type === 'code').length;
  const short  = State.notes.filter(n => n.type === 'short').length;
  const pinned = State.notes.filter(n => n.pinned).length;
  DOM.countAll.textContent    = all;
  DOM.countTheory.textContent = theory;
  DOM.countCode.textContent   = code;
  DOM.countShort.textContent  = short;
  DOM.countPinned.textContent = pinned;
}

// ============================================================
// LISTENERS — inside document
// ============================================================
function attachBookListeners() {
  // Action buttons (pin / edit / delete)
  DOM.bookDocument.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const { action, id } = btn.dataset;
      if (action === 'pin')    togglePin(id);
      if (action === 'edit')   openEditModal(id);
      if (action === 'delete') deleteNote(id);
    });
  });

  // Copy code buttons
  DOM.bookDocument.querySelectorAll('[data-copy]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const id   = btn.dataset.copy;
      const note = State.notes.find(n => n.id === id);
      if (!note) return;
      navigator.clipboard.writeText(note.content).then(() => {
        btn.textContent = '✅ Copied!';
        btn.classList.add('copied');
        setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 2000);
      });
    });
  });
}

// ============================================================
// KEYBOARD SHORTCUTS
// ============================================================
document.addEventListener('keydown', e => {
  const inInput = ['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName);

  if ((e.ctrlKey || e.metaKey) && e.key === 'n' && !inInput) {
    e.preventDefault(); openAddModal();
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    if (DOM.modalOverlay.style.display === 'flex') { e.preventDefault(); saveNote(); }
    else { e.preventDefault(); persistNotes(); }
  }
  if (e.key === 'Escape') {
    if (DOM.modalOverlay.style.display === 'flex') closeModal();
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'f' && !inInput) {
    e.preventDefault(); DOM.searchInput.focus(); DOM.searchInput.select();
  }
});

// Tab → indent in code textarea
DOM.noteContent.addEventListener('keydown', e => {
  if (e.key === 'Tab' && State.activeType === 'code') {
    e.preventDefault();
    const s = DOM.noteContent.selectionStart;
    const v = DOM.noteContent.value;
    DOM.noteContent.value = v.slice(0, s) + '  ' + v.slice(DOM.noteContent.selectionEnd);
    DOM.noteContent.selectionStart = DOM.noteContent.selectionEnd = s + 2;
  }
});

// ============================================================
// WIRE EVENTS
// ============================================================
function wireEvents() {
  DOM.newNoteBtn.addEventListener('click',    openAddModal);
  DOM.openFileBtn.addEventListener('click',   openFile);
  DOM.exportBtn.addEventListener('click',     saveFile);
  DOM.sidebarFileBox.addEventListener('click',openFile);

  DOM.modalClose.addEventListener('click',    closeModal);
  DOM.cancelBtn.addEventListener('click',     closeModal);
  DOM.modalOverlay.addEventListener('click', e => { if (e.target === DOM.modalOverlay) closeModal(); });

  DOM.saveNoteBtn.addEventListener('click',   saveNote);

  DOM.typePills.forEach(p => p.addEventListener('click', () => setActiveType(p.dataset.type)));

  DOM.searchInput.addEventListener('input', e => {
    State.searchQuery = e.target.value;
    DOM.searchClear.classList.toggle('visible', !!State.searchQuery);
    renderDocument();
  });
  DOM.searchClear.addEventListener('click', () => {
    DOM.searchInput.value = '';
    State.searchQuery     = '';
    DOM.searchClear.classList.remove('visible');
    renderDocument();
    DOM.searchInput.focus();
  });

  DOM.sortSelect.addEventListener('change', e => {
    State.sortOrder = e.target.value;
    renderDocument();
  });

  DOM.navItems.forEach(item => {
    item.addEventListener('click', () => {
      DOM.navItems.forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      State.activeFilter = item.dataset.filter;
      renderDocument();
      // Close sidebar on mobile
      if (window.innerWidth <= 900) closeSidebar();
    });
  });

  // Mobile sidebar toggle
  DOM.sidebarToggle.addEventListener('click', () => {
    State.sidebarOpen ? closeSidebar() : openSidebar();
  });
  document.addEventListener('click', e => {
    if (State.sidebarOpen &&
        !DOM.sidebar.contains(e.target) &&
        e.target !== DOM.sidebarToggle) {
      closeSidebar();
    }
  });
}

function openSidebar()  { DOM.sidebar.classList.add('open');    State.sidebarOpen = true; }
function closeSidebar() { DOM.sidebar.classList.remove('open'); State.sidebarOpen = false; }

// ============================================================
// INIT
// ============================================================
async function init() {
  wireEvents();
  await loadNotesOnStartup();

  console.log(
    '%cNoteVault Shortcuts%c\nCtrl+N — New note\nCtrl+S — Save\nCtrl+F — Search\nEsc    — Close modal',
    'color:#a78bfa;font-weight:bold;font-size:13px;',
    'color:#60a5fa;font-size:11px;'
  );
}

document.addEventListener('DOMContentLoaded', init);
