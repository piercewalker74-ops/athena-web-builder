export function buildStudioHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Athena SFX Studio</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#070a07;color:#b8983a;font-family:'Courier New',monospace;font-size:12px;display:flex;flex-direction:column;height:100vh;overflow:hidden}
h1{color:#00c8ff;font-size:13px;letter-spacing:.2em;padding:.6rem 1rem;border-bottom:1px solid #1a2a1a;flex-shrink:0}
.toolbar{display:flex;align-items:center;gap:.5rem;padding:.5rem 1rem;background:#0b0f0b;border-bottom:1px solid #1a2a1a;flex-shrink:0;flex-wrap:wrap}
.toolbar label{font-size:9px;letter-spacing:.15em;color:#7a6830;margin-right:.2rem}
button{background:none;border:1px solid #4a3820;color:#b8983a;font:inherit;font-size:9px;letter-spacing:.1em;padding:3px 10px;cursor:pointer;text-transform:uppercase}
button:hover{border-color:#b8983a;color:#fff}
.btn-save{border-color:#39ff14;color:#39ff14;padding:4px 14px}
.btn-save:hover{background:rgba(57,255,20,.07)}
.main{display:flex;flex:1;overflow:hidden}
.buckets{width:360px;flex-shrink:0;overflow-y:auto;padding:.6rem;border-right:1px solid #1a2a1a}
.bucket{border:1px solid #1a2a1a;margin-bottom:.6rem;padding:.4rem .5rem;min-height:46px}
.bucket.over{border-color:#00c8ff;background:rgba(0,200,255,.04)}
.bhead{font-size:9px;letter-spacing:.13em;color:#00c8ff;margin-bottom:.35rem}
.bhead em{color:#4a5840;font-style:normal;font-size:8px}
.chip{display:inline-flex;align-items:center;gap:3px;border:1px solid #2a3a2a;background:#0a110a;color:#7a9870;font-size:8px;padding:2px 6px;margin:2px;cursor:pointer}
.chip:hover{border-color:#ff3300}.chip .x{color:#ff3300;font-size:11px;padding:0 1px}
.filelist{flex:1;overflow-y:auto;padding:.4rem .6rem}
.frow{display:flex;align-items:center;gap:.5rem;padding:4px 0;border-bottom:1px solid #0e150e;cursor:grab}
.frow:hover{background:rgba(184,152,58,.05)}
.frow.dragging{opacity:.3}
.frow.assigned .flabel{color:#b8983a}
.flabel{flex:1;font-size:10px;color:#7a6830;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pbtn{border-color:#00c8ff;color:#00c8ff;padding:2px 8px;font-size:11px;flex-shrink:0;min-width:28px}
.pbtn:hover{background:rgba(0,200,255,.12)}
.pbtn.playing{background:rgba(0,200,255,.18);border-color:#fff;color:#fff}
.status{font-size:9px;color:#4a5840;padding:.3rem 1rem;border-top:1px solid #1a2a1a;flex-shrink:0;display:flex;justify-content:space-between}
.nowplaying{color:#00c8ff;max-width:50%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
</style>
</head>
<body>
<h1>// ATHENA SFX STUDIO</h1>
<div class="toolbar">
  <label>DEMO:</label>
  <button onclick="demo('interfaceBoot')">Boot Fanfare</button>
  <button onclick="demo('bootLine')">Boot Line</button>
  <button onclick="demo('openPanel')">Nav Click</button>
  <button onclick="demo('typeKey')">Typing</button>
  <button onclick="demo('autoType')">Auto-Type</button>
  <button onclick="demo('background')">Background</button>
  <button onclick="demo('thinking')">Thinking</button>
  <button onclick="demo('ominous')">Ominous</button>
  <button class="btn-save" onclick="saveMap()">&#9654;&nbsp;SAVE MAPPING</button>
</div>
<div class="main">
  <div class="buckets" id="buckets"></div>
  <div class="filelist" id="filelist"></div>
</div>
<div class="status">
  <span id="msg">Loading...</span>
  <span id="np" class="nowplaying"></span>
</div>
<script>
const CATS = [
  {k:'interfaceBoot', l:'Boot Fanfare',    h:'once at boot complete'},
  {k:'bootLine',      l:'Boot Beeps',      h:'per line during boot sequence'},
  {k:'openPanel',     l:'Nav Click',       h:'every section change, rotates'},
  {k:'typeKey',       l:'Key Click',       h:'per keystroke, rotates'},
  {k:'autoType',      l:'Auto-Type Main',  h:'during AI streaming response'},
  {k:'autoTypeExtra', l:'Auto-Type Extra', h:'25% mixed with main'},
  {k:'background',    l:'Ambient Loop',    h:'looping bed, very quiet'},
  {k:'thinking',      l:'Thinking Pulse',  h:'automation fired ping'},
  {k:'ominous',       l:'Ominous / Klaxon',h:'errors and alerts'},
];

let files = [], map = {}, dragFile = null, curAudio = null, curBtn = null;

function play(file, btn) {
  if (curAudio) { try { curAudio.pause(); } catch(e){} curAudio = null; }
  if (curBtn)   { curBtn.classList.remove('playing'); curBtn.textContent = '▶'; curBtn = null; }
  const a = new Audio('/sfx/' + file);
  a.volume = 0.8;
  curAudio = a;
  if (btn) { curBtn = btn; btn.classList.add('playing'); btn.textContent = '■'; }
  document.getElementById('np').textContent = '▶ ' + file.split('/').pop();
  a.play().catch(err => setMsg('Error: ' + err.message));
  a.onended = () => {
    if (curBtn) { curBtn.classList.remove('playing'); curBtn.textContent = '▶'; curBtn = null; }
    document.getElementById('np').textContent = '';
    curAudio = null;
  };
}

function demo(evt) {
  const pool = map[evt] || [];
  if (!pool.length) { setMsg('Nothing mapped to ' + evt + ' yet'); return; }
  const f = pool[Math.floor(Math.random() * pool.length)];
  const row = document.querySelector('[data-f="' + f.replace(/"/g,'\\"') + '"]');
  play(f, row ? row.querySelector('.pbtn') : null);
}

function isAssigned(f) { return Object.values(map).some(a => a.includes(f)); }

function renderBuckets() {
  const el = document.getElementById('buckets');
  el.innerHTML = '';
  for (const c of CATS) {
    const b = document.createElement('div');
    b.className = 'bucket';
    b.innerHTML = '<div class="bhead">' + c.l + ' <em>(' + c.h + ')</em></div>';
    for (const f of (map[c.k] || [])) {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.title = 'Click to preview · × to remove';
      chip.textContent = f.split('/').pop();
      const xb = document.createElement('span'); xb.className = 'x'; xb.textContent = '×'; chip.appendChild(xb);
      chip.querySelector('.x').addEventListener('click', e => {
        e.stopPropagation();
        map[c.k] = (map[c.k] || []).filter(x => x !== f);
        renderAll();
      });
      chip.addEventListener('click', () => {
        const row = document.querySelector('[data-f="' + f.replace(/"/g,'\\"') + '"]');
        play(f, row ? row.querySelector('.pbtn') : null);
      });
      b.appendChild(chip);
    }
    b.addEventListener('dragover',  e => { e.preventDefault(); b.classList.add('over'); });
    b.addEventListener('dragleave', () => b.classList.remove('over'));
    b.addEventListener('drop', e => {
      e.preventDefault(); b.classList.remove('over');
      if (!dragFile) return;
      if (!map[c.k]) map[c.k] = [];
      if (!map[c.k].includes(dragFile)) {
        map[c.k].push(dragFile);
        setMsg('Added ' + dragFile.split('/').pop() + ' → ' + c.l);
        renderAll();
      }
    });
    el.appendChild(b);
  }
}

function renderFiles() {
  const el = document.getElementById('filelist');
  el.innerHTML = '';
  for (const f of files) {
    const row = document.createElement('div');
    row.className = 'frow' + (isAssigned(f) ? ' assigned' : '');
    row.draggable = true;
    row.dataset.f = f;
    const btn = document.createElement('button');
    btn.className = 'pbtn';
    btn.textContent = '▶';
    btn.title = 'Play ' + f;
    btn.addEventListener('click', e => { e.stopPropagation(); play(f, btn); });
    const lbl = document.createElement('span');
    lbl.className = 'flabel';
    lbl.textContent = f;
    lbl.title = f;
    row.appendChild(btn);
    row.appendChild(lbl);
    row.addEventListener('dragstart', e => {
      dragFile = f;
      row.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'copy';
    });
    row.addEventListener('dragend', () => {
      dragFile = null;
      row.classList.remove('dragging');
    });
    el.appendChild(row);
  }
}

function renderAll() { renderBuckets(); renderFiles(); }

async function saveMap() {
  const body = { _note: 'event -> file list. SoundEngine picks randomly from array.', ...map };
  try {
    const r = await fetch('/api/sfx/sound-map', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body, null, 2),
    });
    setMsg(r.ok ? 'Saved! Reload localhost:5173 to hear the new mapping.' : 'Save failed.');
  } catch(e) { setMsg('Save error: ' + e.message); }
}

function setMsg(t) { document.getElementById('msg').textContent = t; }

async function init() {
  try {
    const [fr, mr] = await Promise.all([
      fetch('/api/sfx/files').then(r => r.json()),
      fetch('/sfx/sound-map.json').then(r => r.json()),
    ]);
    files = fr.files || [];
    for (const [k, v] of Object.entries(mr)) {
      if (!k.startsWith('_') && Array.isArray(v)) map[k] = v;
    }
    renderAll();
    setMsg(files.length + ' files loaded — drag from the RIGHT list into LEFT buckets, then Save.');
  } catch(e) { setMsg('Load error: ' + e.message); }
}
init();
</script>
</body>
</html>`;
}
