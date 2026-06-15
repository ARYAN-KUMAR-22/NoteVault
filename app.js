/**
 * NoteVault v2 — App Logic (Refined)
 * ====================================
 * READING:   Click-to-expand focus/reader mode with prev/next navigation
 * CREATING:  Slide-out editor panel with live Markdown preview, auto-resize textarea
 * SAVING:    Auto-save with debounce, visual save state indicator, undo-delete
 * LAYOUT:    Card-style notes, wider content, enhanced typography
 *
 * PERSISTENCE STRATEGY:
 *   READ  → fetch('./notes.json') on every page load
 *   WRITE → File System Access API; user links notes.json once, handle stored in IndexedDB
 *   NO localStorage — everything lives in notes.json
 */

'use strict';

// ============================================================
// STATE
// ============================================================
const State = {
  notes:        [],
  fileHandle:   null,
  activeFilter: 'all',
  searchQuery:  '',
  sortOrder:    'sequence',
  editingId:    null,
  activeType:   'theory',
  sidebarOpen:  false,
  cmdOpen:      false,
  cmdIndex:     0,
  // Editor
  editorOpen:   false,
  editorTab:    'write',   // 'write' | 'preview'
  // Focus view
  focusId:      null,
  focusNotes:   [],
  focusIdx:     -1,
  // Undo
  deletedNote:  null,
  deleteTimer:  null,
};

// ============================================================
// INDEXEDDB
// ============================================================
const IDB_NAME = 'notevault_db', IDB_STORE = 'handles', IDB_KEY = 'notes_file_handle', IDB_VERSION = 1;

function openIDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = e => e.target.result.createObjectStore(IDB_STORE);
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = e => reject(e.target.error);
  });
}
async function saveHandleToIDB(handle) {
  try {
    const db = await openIDB();
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(handle, IDB_KEY);
    await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = rej; });
  } catch (e) { console.warn('IDB save error:', e); }
}
async function loadHandleFromIDB() {
  try {
    const db = await openIDB();
    return new Promise(resolve => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(IDB_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
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
// CONFIGURE MARKED.JS
// ============================================================
function configureMarked() {
  if (typeof marked === 'undefined') return;
  marked.setOptions({
    breaks: true,
    gfm: true,
    highlight: function(code, lang) {
      if (typeof hljs !== 'undefined' && lang && hljs.getLanguage(lang)) {
        try { return hljs.highlight(code, { language: lang }).value; } catch {}
      }
      return code;
    },
  });
}

// ============================================================
// DOM REFERENCES
// ============================================================
const $ = id => document.getElementById(id);

const DOM = {
  bookDocument:   $('bookDocument'),
  bookView:       $('bookView'),
  emptyState:     $('emptyState'),
  noResultsState: $('noResultsState'),
  bookTopTitle:   $('bookTopTitle'),
  noteSeqInfo:    $('noteSeqInfo'),
  // Save state
  saveState:      $('saveState'),
  saveText:       $('saveText'),
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
  // Editor panel
  editorPanel:    $('editorPanel'),
  editorBackdrop: $('editorBackdrop'),
  editorTitle:    $('editorTitle'),
  editorClose:    $('editorClose'),
  editorTabs:     $('editorTabs'),
  tabWrite:       $('tabWrite'),
  tabPreview:     $('tabPreview'),
  editorPreview:  $('editorPreview'),
  cancelBtn:      $('cancelBtn'),
  saveNoteBtn:    $('saveNoteBtn'),
  typePills:      document.querySelectorAll('.type-pill'),
  noteTitle:      $('noteTitle'),
  noteContent:    $('noteContent'),
  noteTags:       $('noteTags'),
  pinToggle:      $('pinToggle'),
  langRow:        $('langRow'),
  langSelect:     $('langSelect'),
  mdHint:         $('mdHint'),
  // Focus view
  focusView:      $('focusView'),
  focusContent:   $('focusContent'),
  focusBackBtn:   $('focusBackBtn'),
  focusEditBtn:   $('focusEditBtn'),
  focusPinBtn:    $('focusPinBtn'),
  focusDeleteBtn: $('focusDeleteBtn'),
  focusPrevBtn:   $('focusPrevBtn'),
  focusNextBtn:   $('focusNextBtn'),
  focusPosition:  $('focusPosition'),
  // Command palette
  cmdOverlay:     $('cmdOverlay'),
  cmdInput:       $('cmdInput'),
  cmdResults:     $('cmdResults'),
  // Status
  fileStatus:     $('fileStatus'),
  lastSaved:      $('lastSaved'),
  statusFilter:   $('statusFilter'),
  statusCount:    $('statusCount'),
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
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
}
function timeAgo(iso) {
  if (!iso) return '';
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s/60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m/60); if (h < 24) return `${h}h ago`;
  const d = Math.floor(h/24); if (d < 30) return `${d}d ago`;
  return formatDate(iso);
}
function parseTags(raw) { return (raw || '').split(',').map(t => t.trim().toLowerCase()).filter(Boolean); }
function wordCount(text) { if (!text) return 0; return text.trim().split(/\s+/).filter(Boolean).length; }
function readingTime(words) { const m = Math.ceil(words / 200); return m <= 1 ? '1 min read' : `${m} min read`; }

// ============================================================
// TOAST (with optional action button)
// ============================================================
function showToast(msg, type = 'info', ms = 3000, action = null) {
  const icons = { success:'✅', error:'❌', info:'ℹ️' };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  let html = `<span>${icons[type]||''}</span><span>${escapeHtml(msg)}</span>`;
  if (action) html += `<button class="toast-action">${escapeHtml(action.label)}</button>`;
  el.innerHTML = html;
  if (action) {
    el.querySelector('.toast-action').addEventListener('click', () => { action.onClick(); el.remove(); });
  }
  DOM.toastContainer.appendChild(el);
  const timer = setTimeout(() => {
    el.style.animation = 'tOut 0.3s ease forwards';
    setTimeout(() => el.remove(), 300);
  }, ms);
  return { el, cancel: () => { clearTimeout(timer); el.remove(); } };
}

// ============================================================
// SAVE STATE INDICATOR
// ============================================================
function setSaveState(state, text) {
  DOM.saveState.className = `save-state ${state}`;
  DOM.saveText.textContent = text || {
    'saved': 'All saved',
    'unsaved': 'Unsaved changes',
    'saving': 'Saving…',
    'error': 'Save failed',
    'no-file': 'No file linked',
  }[state] || state;
}

// ============================================================
// PERSISTENCE — AUTO-SAVE
// ============================================================
let autoSaveTimer = null;

function buildPayload() {
  return JSON.stringify({ version: 2, notes: State.notes }, null, 2);
}

async function writeToFileHandle(handle, payload) {
  const writable = await handle.createWritable();
  await writable.write(payload);
  await writable.close();
}

function scheduleAutoSave() {
  if (!State.fileHandle) {
    setSaveState('no-file', 'No file linked');
    return;
  }
  setSaveState('unsaved');
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => persistNotes(), 2000);
}

async function persistNotes() {
  if (!State.fileHandle) {
    setSaveState('no-file', 'No file linked');
    return;
  }
  setSaveState('saving');
  try {
    let perm = await State.fileHandle.queryPermission({ mode: 'readwrite' });
    if (perm !== 'granted') {
      perm = await State.fileHandle.requestPermission({ mode: 'readwrite' });
    }
    if (perm === 'granted') {
      await writeToFileHandle(State.fileHandle, buildPayload());
      setSaveState('saved');
      DOM.lastSaved.textContent = `Saved ${new Date().toLocaleTimeString()}`;
    } else {
      setSaveState('error', 'Permission denied');
      showToast('Write permission denied for notes.json.', 'error');
    }
  } catch (err) {
    console.error('File write error:', err);
    setSaveState('error');
    showToast('Failed to write to notes.json!', 'error');
  }
}

function setFileUI(name, sub) {
  DOM.fileBoxName.textContent = name;
  DOM.fileBoxSub.textContent = sub;
  DOM.fileStatus.textContent = State.fileHandle
    ? `📄 ${name} — all changes saved to file`
    : '⚠️ No file linked — click "Open File" to link notes.json';
  if (State.fileHandle) {
    setSaveState('saved');
  } else {
    setSaveState('no-file');
  }
}

// ============================================================
// LOAD NOTES
// ============================================================
async function loadNotesOnStartup() {
  try {
    const res = await fetch('./notes.json', { cache: 'no-store' });
    if (res.ok) {
      const text = await res.text();
      if (text.trim()) {
        const parsed = JSON.parse(text);
        State.notes = Array.isArray(parsed) ? parsed : (parsed.notes || []);
      }
    }
  } catch (err) { console.warn('Could not fetch notes.json:', err); }

  const handle = await loadHandleFromIDB();
  if (handle) {
    try {
      let perm = await handle.queryPermission({ mode: 'readwrite' });
      if (perm === 'granted') {
        State.fileHandle = handle;
        setFileUI(handle.name, `Linked • ${State.notes.length} notes loaded`);
      } else if (perm === 'prompt') {
        State.fileHandle = handle;
        setFileUI(handle.name, `Linked (permission needed on first save)`);
      }
    } catch {
      await clearHandleFromIDB();
      setFileUI('notes.json', `${State.notes.length} notes (read-only until you re-link)`);
    }
  } else {
    if (State.notes.length > 0) {
      setFileUI('notes.json', `${State.notes.length} notes loaded — link file to enable saving`);
      DOM.fileStatus.textContent = '⚠️ Read-only: click "Open File" to enable saving';
    } else {
      setFileUI('notes.json', 'Empty — link file to start saving');
      DOM.fileStatus.textContent = '⚠️ Click "Open File" and select your notes.json';
    }
  }

  renderDocument();
  if (State.notes.length > 0 && State.fileHandle) {
    showToast(`Loaded ${State.notes.length} notes`, 'success');
  }
}

// ============================================================
// OPEN / SAVE FILE
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
    const file = await handle.getFile();
    const text = await file.text();
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
    id: uuid(),
    type: type || 'theory',
    title: title.trim() || 'Untitled',
    content: content.trim(),
    language: language || null,
    tags: parseTags(tags),
    pinned: !!pinned,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function saveNote() {
  const title = DOM.noteTitle.value;
  const content = DOM.noteContent.value.trim();
  const tags = DOM.noteTags.value;
  const pinned = DOM.pinToggle.checked;
  const type = State.activeType;
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
    State.notes.push(createNote({ type, title, content, language, tags, pinned }));
    showToast('Note added!', 'success');
  }

  const wasEditing = State.editingId;
  closeEditor();
  scheduleAutoSave();
  renderDocument();

  // If in focus view and was editing, re-render focus
  if (State.focusId && wasEditing) {
    renderFocusView();
  }

  if (!wasEditing) {
    setTimeout(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }), 100);
  }
}

function deleteNote(id) {
  const idx = State.notes.findIndex(n => n.id === id);
  if (idx === -1) return;

  // Store for undo
  const removed = State.notes[idx];
  const removedIdx = idx;
  State.notes.splice(idx, 1);

  // If in focus view, go back
  if (State.focusId === id) closeFocusView();

  scheduleAutoSave();
  renderDocument();

  // Clear previous undo timer
  clearTimeout(State.deleteTimer);
  State.deletedNote = { note: removed, index: removedIdx };

  // Show undo toast
  showToast('Note deleted', 'info', 5000, {
    label: 'Undo',
    onClick: () => {
      if (State.deletedNote) {
        State.notes.splice(State.deletedNote.index, 0, State.deletedNote.note);
        State.deletedNote = null;
        clearTimeout(State.deleteTimer);
        scheduleAutoSave();
        renderDocument();
        showToast('Note restored!', 'success');
      }
    }
  });

  State.deleteTimer = setTimeout(() => { State.deletedNote = null; }, 5000);
}

function togglePin(id) {
  const note = State.notes.find(n => n.id === id);
  if (!note) return;
  note.pinned = !note.pinned;
  note.updatedAt = new Date().toISOString();
  scheduleAutoSave();
  renderDocument();
  if (State.focusId === id) renderFocusView();
  showToast(note.pinned ? 'Note pinned 📌' : 'Note unpinned', 'info');
}

// ============================================================
// EDITOR PANEL (replaces modal)
// ============================================================
function openEditor() {
  State.editorOpen = true;
  State.editorTab = 'write';
  DOM.editorPanel.classList.add('open');
  DOM.editorBackdrop.classList.add('open');
  document.body.style.overflow = 'hidden';
  showEditorTab('write');
  autoResizeTextarea();
}

function closeEditor() {
  State.editorOpen = false;
  DOM.editorPanel.classList.remove('open');
  DOM.editorBackdrop.classList.remove('open');
  document.body.style.overflow = '';
  State.editingId = null;
  resetForm();
}

function openAddEditor() {
  State.editingId = null;
  DOM.editorTitle.textContent = 'New Note';
  DOM.saveNoteBtn.textContent = 'Save Note';
  resetForm();
  setActiveType('theory');
  openEditor();
  setTimeout(() => DOM.noteTitle.focus(), 80);
}

function openEditEditor(id) {
  const note = State.notes.find(n => n.id === id);
  if (!note) return;
  State.editingId = id;
  DOM.editorTitle.textContent = 'Edit Note';
  DOM.saveNoteBtn.textContent = 'Update Note';
  setActiveType(note.type);
  DOM.noteTitle.value = note.title;
  DOM.noteContent.value = note.content;
  DOM.noteTags.value = note.tags.join(', ');
  DOM.pinToggle.checked = note.pinned;
  if (note.type === 'code' && note.language) DOM.langSelect.value = note.language;
  openEditor();
  setTimeout(() => { DOM.noteTitle.focus(); autoResizeTextarea(); }, 80);
}

function resetForm() {
  DOM.noteTitle.value = '';
  DOM.noteContent.value = '';
  DOM.noteTags.value = '';
  DOM.pinToggle.checked = false;
  DOM.langSelect.value = 'python';
  DOM.noteContent.classList.remove('code-mode');
  DOM.noteContent.style.height = '';
}

// ============================================================
// WRITE / PREVIEW TABS
// ============================================================
function showEditorTab(tab) {
  State.editorTab = tab;
  DOM.tabWrite.classList.toggle('active', tab === 'write');
  DOM.tabPreview.classList.toggle('active', tab === 'preview');

  if (tab === 'write') {
    DOM.noteContent.style.display = '';
    DOM.editorPreview.style.display = 'none';
    autoResizeTextarea();
  } else {
    DOM.noteContent.style.display = 'none';
    DOM.editorPreview.style.display = 'block';
    // Render preview
    const content = DOM.noteContent.value;
    if (typeof marked !== 'undefined') {
      try {
        DOM.editorPreview.innerHTML = marked.parse(content) || '<p style="color:var(--text-4);">Nothing to preview</p>';
      } catch {
        DOM.editorPreview.innerHTML = escapeHtml(content).replace(/\n/g, '<br>');
      }
    } else {
      DOM.editorPreview.innerHTML = escapeHtml(content).replace(/\n/g, '<br>');
    }
  }
}

// ============================================================
// AUTO-RESIZE TEXTAREA
// ============================================================
function autoResizeTextarea() {
  const ta = DOM.noteContent;
  if (State.activeType === 'code') return; // Code keeps manual resize
  ta.style.height = 'auto';
  ta.style.height = Math.max(180, ta.scrollHeight) + 'px';
}

// ============================================================
// TYPE SELECTOR
// ============================================================
function setActiveType(type) {
  State.activeType = type;
  DOM.typePills.forEach(p => p.classList.toggle('active', p.dataset.type === type));
  DOM.langRow.style.display = type === 'code' ? 'block' : 'none';
  DOM.mdHint.style.display = type === 'theory' ? 'flex' : 'none';
  DOM.editorTabs.style.display = type === 'theory' ? 'flex' : 'none';

  if (type === 'code') {
    DOM.noteContent.classList.add('code-mode');
    DOM.noteContent.placeholder = 'Write your code here…';
    DOM.noteContent.style.height = '';
    DOM.noteContent.style.minHeight = '250px';
    DOM.noteContent.style.resize = 'vertical';
    DOM.noteContent.style.overflow = 'auto';
  } else if (type === 'short') {
    DOM.noteContent.classList.remove('code-mode');
    DOM.noteContent.placeholder = 'Quick tip, fact, or reminder…';
    DOM.noteContent.style.minHeight = '80px';
    DOM.noteContent.style.resize = 'none';
    DOM.noteContent.style.overflow = 'hidden';
    autoResizeTextarea();
  } else {
    DOM.noteContent.classList.remove('code-mode');
    DOM.noteContent.placeholder = 'Write your theory or notes here… (Markdown supported)';
    DOM.noteContent.style.minHeight = '180px';
    DOM.noteContent.style.resize = 'none';
    DOM.noteContent.style.overflow = 'hidden';
    autoResizeTextarea();
  }

  // Reset to write tab
  if (State.editorTab === 'preview') showEditorTab('write');
}

// ============================================================
// FOCUS VIEW — Immersive reading
// ============================================================
function openFocusView(noteId) {
  const note = State.notes.find(n => n.id === noteId);
  if (!note) return;

  State.focusId = noteId;
  DOM.bookView.style.display = 'none';
  DOM.emptyState.style.display = 'none';
  DOM.noResultsState.style.display = 'none';
  DOM.focusView.style.display = 'flex';
  DOM.bookTopTitle.textContent = note.title;

  renderFocusView();
  window.scrollTo({ top: 0 });
}

function closeFocusView() {
  State.focusId = null;
  DOM.focusView.style.display = 'none';
  DOM.bookView.style.display = '';
  renderDocument();
}

function renderFocusView() {
  const note = State.notes.find(n => n.id === State.focusId);
  if (!note) { closeFocusView(); return; }

  const displayNotes = getDisplayNotes();
  State.focusNotes = displayNotes;
  State.focusIdx = displayNotes.findIndex(n => n.id === note.id);

  // Render note
  let inner = '';
  if (note.type === 'theory') inner = renderTheory(note);
  else if (note.type === 'code') inner = renderCode(note);
  else inner = renderShort(note);

  DOM.focusContent.innerHTML = inner;

  // Update topbar title
  DOM.bookTopTitle.textContent = note.title;

  // Update pin button
  DOM.focusPinBtn.textContent = note.pinned ? '📌 Unpin' : '📌 Pin';
  DOM.focusPinBtn.classList.toggle('pin-active', note.pinned);

  // Update nav
  const total = displayNotes.length;
  DOM.focusPosition.textContent = State.focusIdx >= 0 ? `${State.focusIdx + 1} of ${total}` : '';
  DOM.focusPrevBtn.disabled = State.focusIdx <= 0;
  DOM.focusNextBtn.disabled = State.focusIdx >= total - 1;
}

function focusNavigate(direction) {
  const nextIdx = State.focusIdx + direction;
  if (nextIdx < 0 || nextIdx >= State.focusNotes.length) return;
  openFocusView(State.focusNotes[nextIdx].id);
}

// ============================================================
// FILTER & SORT
// ============================================================
function getDisplayNotes() {
  let notes = [...State.notes];
  if (State.activeFilter === 'pinned') notes = notes.filter(n => n.pinned);
  else if (State.activeFilter !== 'all') notes = notes.filter(n => n.type === State.activeFilter);
  if (State.searchQuery) {
    const q = State.searchQuery.toLowerCase();
    notes = notes.filter(n =>
      n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q) || n.tags.some(t => t.includes(q))
    );
  }
  if (State.sortOrder !== 'sequence') {
    notes.sort((a, b) => {
      switch (State.sortOrder) {
        case 'newest': return new Date(b.createdAt) - new Date(a.createdAt);
        case 'oldest': return new Date(a.createdAt) - new Date(b.createdAt);
        case 'title':  return a.title.localeCompare(b.title);
        case 'updated':return new Date(b.updatedAt) - new Date(a.updatedAt);
        default: return 0;
      }
    });
  }
  return notes;
}

// ============================================================
// RENDER — THEORY NOTE (Markdown)
// ============================================================
function renderTheory(note) {
  const pinFlag = note.pinned ? `<div class="theory-pin-flag">📌 Pinned</div>` : '';
  const tagsHtml = note.tags.length
    ? `<div class="theory-tags">${note.tags.map(t => `<span class="theory-tag">#${escapeHtml(t)}</span>`).join('')}</div>` : '';
  const wc = wordCount(note.content);
  const readInfo = wc > 0
    ? `<div class="theory-reading-info"><span>📝 ${wc} word${wc !== 1 ? 's' : ''}</span><span>⏱ ${readingTime(wc)}</span></div>` : '';

  let bodyHtml;
  if (typeof marked !== 'undefined') {
    try { bodyHtml = marked.parse(note.content); }
    catch { bodyHtml = escapeHtml(note.content).replace(/\n/g, '<br>'); }
  } else {
    bodyHtml = escapeHtml(note.content).replace(/\n/g, '<br>');
  }

  const updatedInfo = note.updatedAt !== note.createdAt ? `<span>Edited ${timeAgo(note.updatedAt)}</span>` : '';

  return `
    <div class="note-theory" data-id="${note.id}">
      ${pinFlag}
      <h2 class="theory-title">${escapeHtml(note.title)}</h2>
      ${readInfo}
      ${tagsHtml}
      <div class="theory-body">${bodyHtml}</div>
      <div class="theory-meta">
        <span>📖 Theory</span>
        <span>${formatDate(note.createdAt)}</span>
        ${updatedInfo}
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
    highlighted = hljs.getLanguage(lang) ? hljs.highlight(note.content, { language: lang }).value : escapeHtml(note.content);
  } catch { highlighted = escapeHtml(note.content); }

  const tagsHtml = note.tags.length
    ? `<div class="code-note-tags">${note.tags.map(t => `<span class="code-note-tag">#${escapeHtml(t)}</span>`).join('')}</div>` : '';
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
      <div class="code-note-meta"><span>💻 Code</span><span>${formatDate(note.createdAt)}</span></div>
    </div>
  `;
}

// ============================================================
// RENDER — SHORT NOTE
// ============================================================
function renderShort(note) {
  const tagsHtml = note.tags.length
    ? `<div class="short-tags">${note.tags.map(t => `<span class="short-tag">#${escapeHtml(t)}</span>`).join('')}</div>` : '';
  const pinIcon = note.pinned ? '📌' : '⚡';
  return `
    <div class="note-short" data-id="${note.id}">
      <div class="short-callout">
        <span class="short-icon">${pinIcon}</span>
        <div class="short-inner">
          <div class="short-title">${escapeHtml(note.title)}</div>
          <div class="short-body">${escapeHtml(note.content)}</div>
          <div class="short-footer">${tagsHtml}<span class="short-date">${timeAgo(note.createdAt)}</span></div>
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
  updateStatusBar();

  // Don't touch DOM if focus view is showing
  if (State.focusId) return;

  const notes = getDisplayNotes();
  const filterLabel = { all:'All Notes', theory:'Theory Notes', code:'Code Snippets', short:'Short Notes', pinned:'Pinned Notes' };
  DOM.bookTopTitle.textContent = filterLabel[State.activeFilter] || 'Notes';
  DOM.noteSeqInfo.textContent = notes.length > 0 ? `${notes.length} note${notes.length !== 1 ? 's' : ''}` : '';

  if (State.notes.length === 0) {
    DOM.bookDocument.innerHTML = '';
    DOM.emptyState.style.display = 'flex';
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

  const canDrag = State.sortOrder === 'sequence' && State.activeFilter === 'all' && !State.searchQuery;

  const fragments = notes.map((note, idx) => {
    let inner = '';
    if (note.type === 'theory') inner = renderTheory(note);
    else if (note.type === 'code') inner = renderCode(note);
    else inner = renderShort(note);

    const sep = idx < notes.length - 1 ? '<div class="note-separator"></div>' : '';
    const dragHandle = canDrag ? `<div class="drag-handle" title="Drag to reorder">⠿</div>` : '';
    const delay = Math.min(idx * 0.04, 0.6);

    return `
      <div class="note-entry" data-id="${note.id}" ${canDrag ? 'draggable="true"' : ''}
           style="animation-delay:${delay}s;">
        ${dragHandle}
        <div class="entry-actions">
          <button class="entry-btn pin${note.pinned ? ' active' : ''}"
            data-action="pin" data-id="${note.id}" title="${note.pinned ? 'Unpin' : 'Pin'}">📌</button>
          <button class="entry-btn" data-action="edit" data-id="${note.id}" title="Edit">✏️</button>
          <button class="entry-btn del" data-action="delete" data-id="${note.id}" title="Delete">🗑️</button>
        </div>
        ${inner}
      </div>
      ${sep}
    `;
  });

  DOM.bookDocument.innerHTML = fragments.join('');
  attachBookListeners();
  if (canDrag) attachDragListeners();
}

function updateCounts() {
  DOM.countAll.textContent = State.notes.length;
  DOM.countTheory.textContent = State.notes.filter(n => n.type === 'theory').length;
  DOM.countCode.textContent = State.notes.filter(n => n.type === 'code').length;
  DOM.countShort.textContent = State.notes.filter(n => n.type === 'short').length;
  DOM.countPinned.textContent = State.notes.filter(n => n.pinned).length;
}

function updateStatusBar() {
  const labels = { all:'All', theory:'Theory', code:'Code', short:'Short', pinned:'Pinned' };
  DOM.statusFilter.textContent = labels[State.activeFilter] || 'All';
  DOM.statusCount.textContent = `${State.notes.length} note${State.notes.length !== 1 ? 's' : ''}`;
}

// ============================================================
// DRAG-TO-REORDER
// ============================================================
let dragSrcId = null;

function attachDragListeners() {
  DOM.bookDocument.querySelectorAll('.note-entry[draggable="true"]').forEach(entry => {
    entry.addEventListener('dragstart', handleDragStart);
    entry.addEventListener('dragover', handleDragOver);
    entry.addEventListener('dragenter', handleDragEnter);
    entry.addEventListener('dragleave', handleDragLeave);
    entry.addEventListener('drop', handleDrop);
    entry.addEventListener('dragend', handleDragEnd);
  });
}
function handleDragStart(e) {
  dragSrcId = this.dataset.id;
  this.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', dragSrcId);
}
function handleDragOver(e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }
function handleDragEnter(e) {
  e.preventDefault();
  if (e.currentTarget.dataset.id !== dragSrcId) e.currentTarget.classList.add('drag-over');
}
function handleDragLeave(e) { e.currentTarget.classList.remove('drag-over'); }
function handleDrop(e) {
  e.preventDefault();
  const targetId = this.dataset.id;
  this.classList.remove('drag-over');
  if (dragSrcId && targetId && dragSrcId !== targetId) {
    const srcIdx = State.notes.findIndex(n => n.id === dragSrcId);
    const tgtIdx = State.notes.findIndex(n => n.id === targetId);
    if (srcIdx !== -1 && tgtIdx !== -1) {
      const [moved] = State.notes.splice(srcIdx, 1);
      State.notes.splice(tgtIdx, 0, moved);
      scheduleAutoSave();
      renderDocument();
      showToast('Note reordered', 'info');
    }
  }
}
function handleDragEnd() {
  this.classList.remove('dragging');
  DOM.bookDocument.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
  dragSrcId = null;
}

// ============================================================
// COMMAND PALETTE
// ============================================================
function openCmdPalette() {
  State.cmdOpen = true; State.cmdIndex = 0;
  DOM.cmdOverlay.style.display = 'flex';
  DOM.cmdInput.value = '';
  document.body.style.overflow = 'hidden';
  renderCmdResults('');
  setTimeout(() => DOM.cmdInput.focus(), 50);
}
function closeCmdPalette() {
  State.cmdOpen = false;
  DOM.cmdOverlay.style.display = 'none';
  if (!State.editorOpen) document.body.style.overflow = '';
  DOM.cmdInput.value = '';
}

function getCmdItems(query) {
  const items = [];
  const q = query.toLowerCase().trim();
  const actions = [
    { id:'action:new', icon:'➕', title:'New Note', sub:'Create a new note', type:'action' },
    { id:'action:open', icon:'📂', title:'Open File', sub:'Link a notes.json file', type:'action' },
    { id:'action:save', icon:'💾', title:'Save As', sub:'Export notes to a file', type:'action' },
  ];
  if (!q) items.push(...actions);
  else items.push(...actions.filter(a => a.title.toLowerCase().includes(q) || a.sub.toLowerCase().includes(q)));

  const matchedNotes = State.notes.filter(n => {
    if (!q) return true;
    return n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q) || n.tags.some(t => t.includes(q));
  });
  matchedNotes.slice(0, 15).forEach(n => {
    const typeIcon = n.type === 'theory' ? '📖' : n.type === 'code' ? '💻' : '⚡';
    const preview = n.content.substring(0, 60).replace(/\n/g, ' ');
    items.push({ id:`note:${n.id}`, icon:typeIcon, title:n.title, sub:preview + (n.content.length > 60 ? '…' : ''), type:n.type, noteId:n.id });
  });
  return items;
}

function renderCmdResults(query) {
  const items = getCmdItems(query);
  State.cmdIndex = Math.min(State.cmdIndex, Math.max(0, items.length - 1));
  if (items.length === 0) {
    DOM.cmdResults.innerHTML = '<div class="cmd-empty">No results found</div>';
    return;
  }
  DOM.cmdResults.innerHTML = items.map((item, idx) => {
    const isActive = idx === State.cmdIndex ? ' active' : '';
    const badge = item.type ? `<span class="cmd-item-badge ${item.type}">${item.type}</span>` : '';
    return `
      <div class="cmd-item${isActive}" data-cmd-idx="${idx}" data-cmd-id="${item.id}">
        <div class="cmd-item-icon">${item.icon}</div>
        <div class="cmd-item-text">
          <div class="cmd-item-title">${escapeHtml(item.title)}</div>
          <div class="cmd-item-sub">${escapeHtml(item.sub)}</div>
        </div>
        ${badge}
      </div>
    `;
  }).join('');
  const activeEl = DOM.cmdResults.querySelector('.cmd-item.active');
  if (activeEl) activeEl.scrollIntoView({ block: 'nearest' });
}

function executeCmdItem(id) {
  closeCmdPalette();
  if (id === 'action:new') { openAddEditor(); return; }
  if (id === 'action:open') { openFile(); return; }
  if (id === 'action:save') { saveFile(); return; }
  if (id.startsWith('note:')) {
    const noteId = id.replace('note:', '');
    openFocusView(noteId);
  }
}

// ============================================================
// LISTENERS — inside document
// ============================================================
function attachBookListeners() {
  // Action buttons
  DOM.bookDocument.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const { action, id } = btn.dataset;
      if (action === 'pin') togglePin(id);
      if (action === 'edit') openEditEditor(id);
      if (action === 'delete') deleteNote(id);
    });
  });
  // Copy code buttons
  DOM.bookDocument.querySelectorAll('[data-copy]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const note = State.notes.find(n => n.id === btn.dataset.copy);
      if (!note) return;
      navigator.clipboard.writeText(note.content).then(() => {
        btn.textContent = '✅ Copied!';
        btn.classList.add('copied');
        setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 2000);
      });
    });
  });
  // Click note to open focus view
  DOM.bookDocument.querySelectorAll('.note-entry').forEach(entry => {
    entry.addEventListener('click', e => {
      if (e.target.closest('.entry-actions') || e.target.closest('.copy-btn') || e.target.closest('.drag-handle')) return;
      openFocusView(entry.dataset.id);
    });
  });
}

// ============================================================
// KEYBOARD SHORTCUTS
// ============================================================
document.addEventListener('keydown', e => {
  const inInput = ['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName);

  // Ctrl+K — Command palette
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault();
    State.cmdOpen ? closeCmdPalette() : openCmdPalette();
    return;
  }

  // Command palette navigation
  if (State.cmdOpen) {
    const items = getCmdItems(DOM.cmdInput.value);
    if (e.key === 'ArrowDown') { e.preventDefault(); State.cmdIndex = Math.min(State.cmdIndex + 1, items.length - 1); renderCmdResults(DOM.cmdInput.value); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); State.cmdIndex = Math.max(State.cmdIndex - 1, 0); renderCmdResults(DOM.cmdInput.value); return; }
    if (e.key === 'Enter') { e.preventDefault(); if (items[State.cmdIndex]) executeCmdItem(items[State.cmdIndex].id); return; }
    if (e.key === 'Escape') { e.preventDefault(); closeCmdPalette(); return; }
    return;
  }

  // Escape
  if (e.key === 'Escape') {
    if (State.editorOpen) { closeEditor(); return; }
    if (State.focusId) { closeFocusView(); return; }
  }

  // Ctrl+N — New note
  if ((e.ctrlKey || e.metaKey) && e.key === 'n' && !inInput) {
    e.preventDefault(); openAddEditor();
  }
  // Ctrl+S — Save
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    if (State.editorOpen) saveNote();
    else persistNotes();
  }
  // Ctrl+F — Search
  if ((e.ctrlKey || e.metaKey) && e.key === 'f' && !inInput) {
    e.preventDefault(); DOM.searchInput.focus(); DOM.searchInput.select();
  }

  // Focus view: arrow keys for prev/next
  if (State.focusId && !State.editorOpen && !inInput) {
    if (e.key === 'ArrowLeft') { focusNavigate(-1); return; }
    if (e.key === 'ArrowRight') { focusNavigate(1); return; }
    if (e.key === 'e' || e.key === 'E') { openEditEditor(State.focusId); return; }
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

// Auto-resize on input
DOM.noteContent.addEventListener('input', () => {
  if (State.activeType !== 'code') autoResizeTextarea();
});

// ============================================================
// WIRE EVENTS
// ============================================================
function wireEvents() {
  DOM.newNoteBtn.addEventListener('click', openAddEditor);
  DOM.openFileBtn.addEventListener('click', openFile);
  DOM.exportBtn.addEventListener('click', saveFile);
  DOM.sidebarFileBox.addEventListener('click', openFile);

  // Editor panel
  DOM.editorClose.addEventListener('click', closeEditor);
  DOM.cancelBtn.addEventListener('click', closeEditor);
  DOM.editorBackdrop.addEventListener('click', closeEditor);
  DOM.saveNoteBtn.addEventListener('click', saveNote);
  DOM.typePills.forEach(p => p.addEventListener('click', () => setActiveType(p.dataset.type)));

  // Write / Preview tabs
  DOM.tabWrite.addEventListener('click', () => showEditorTab('write'));
  DOM.tabPreview.addEventListener('click', () => showEditorTab('preview'));

  // Search
  DOM.searchInput.addEventListener('input', e => {
    State.searchQuery = e.target.value;
    DOM.searchClear.classList.toggle('visible', !!State.searchQuery);
    if (State.focusId) closeFocusView();
    renderDocument();
  });
  DOM.searchClear.addEventListener('click', () => {
    DOM.searchInput.value = '';
    State.searchQuery = '';
    DOM.searchClear.classList.remove('visible');
    renderDocument();
    DOM.searchInput.focus();
  });

  // Sort
  DOM.sortSelect.addEventListener('change', e => {
    State.sortOrder = e.target.value;
    if (State.focusId) closeFocusView();
    renderDocument();
  });

  // Filter nav
  DOM.navItems.forEach(item => {
    item.addEventListener('click', () => {
      DOM.navItems.forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      State.activeFilter = item.dataset.filter;
      if (State.focusId) closeFocusView();
      renderDocument();
      if (window.innerWidth <= 900) closeSidebar();
    });
  });

  // Mobile sidebar
  DOM.sidebarToggle.addEventListener('click', () => { State.sidebarOpen ? closeSidebar() : openSidebar(); });
  document.addEventListener('click', e => {
    if (State.sidebarOpen && !DOM.sidebar.contains(e.target) && e.target !== DOM.sidebarToggle) closeSidebar();
  });

  // Focus view
  DOM.focusBackBtn.addEventListener('click', closeFocusView);
  DOM.focusEditBtn.addEventListener('click', () => { if (State.focusId) openEditEditor(State.focusId); });
  DOM.focusPinBtn.addEventListener('click', () => { if (State.focusId) togglePin(State.focusId); });
  DOM.focusDeleteBtn.addEventListener('click', () => { if (State.focusId) deleteNote(State.focusId); });
  DOM.focusPrevBtn.addEventListener('click', () => focusNavigate(-1));
  DOM.focusNextBtn.addEventListener('click', () => focusNavigate(1));

  // Command palette
  DOM.cmdInput.addEventListener('input', () => { State.cmdIndex = 0; renderCmdResults(DOM.cmdInput.value); });
  DOM.cmdOverlay.addEventListener('click', e => { if (e.target === DOM.cmdOverlay) closeCmdPalette(); });
  DOM.cmdResults.addEventListener('click', e => {
    const item = e.target.closest('.cmd-item');
    if (item) executeCmdItem(item.dataset.cmdId);
  });
}

function openSidebar() { DOM.sidebar.classList.add('open'); State.sidebarOpen = true; }
function closeSidebar() { DOM.sidebar.classList.remove('open'); State.sidebarOpen = false; }

// ============================================================
// INIT
// ============================================================
async function init() {
  configureMarked();
  wireEvents();
  await loadNotesOnStartup();

  console.log(
    '%cNoteVault v2 Shortcuts%c\nCtrl+N — New note\nCtrl+K — Command palette\nCtrl+S — Save\nCtrl+F — Search\nEsc    — Close editor/focus\n← →    — Navigate in reader mode\nE      — Edit in reader mode',
    'color:#a78bfa;font-weight:bold;font-size:13px;',
    'color:#60a5fa;font-size:11px;'
  );
}

document.addEventListener('DOMContentLoaded', init);
