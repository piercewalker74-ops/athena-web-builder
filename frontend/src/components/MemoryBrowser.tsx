import { useEffect, useRef, useState } from 'react';
import { soundEngine } from '../audio/SoundEngine';
import { AmbientBackground } from './AmbientBackground';

interface MemFile {
  name: string;
  path: string;
  size: number;
  mtime: number;
  category: string;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function formatAge(mtime: number): string {
  const diff = Date.now() - mtime;
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

// Simple markdown renderer (headers + bullets)
function MarkdownView({ content }: { content: string }) {
  const lines = content.split('\n');
  return (
    <div className="md-view">
      {lines.map((line, i) => {
        if (line.startsWith('# '))
          return <h1 key={i} className="md-h1">{line.slice(2)}</h1>;
        if (line.startsWith('## '))
          return <h2 key={i} className="md-h2">{line.slice(3)}</h2>;
        if (line.startsWith('### '))
          return <h3 key={i} className="md-h3">{line.slice(4)}</h3>;
        if (line.startsWith('- ') || line.startsWith('* '))
          return <li key={i} className="md-li">{line.slice(2)}</li>;
        if (line.startsWith('```'))
          return <div key={i} className="md-code-fence">{line.slice(3)}</div>;
        if (line.trim() === '')
          return <div key={i} className="md-blank" />;
        return <p key={i} className="md-p">{line}</p>;
      })}
    </div>
  );
}

export function MemoryBrowser() {
  const [files, setFiles]             = useState<MemFile[]>([]);
  const [loading, setLoading]         = useState(true);
  const [selected, setSelected]       = useState<MemFile | null>(null);
  const [content, setContent]         = useState<string | null>(null);
  const [displayed, setDisplayed]     = useState<string | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [filter, setFilter]           = useState('');
  const [catFilter, setCatFilter]     = useState<string>('all');
  const typeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const r = await fetch('/api/memory/files');
        if (r.ok) {
          const data = await r.json() as { files: MemFile[] };
          setFiles(data.files ?? []);
        }
      } catch { /* no backend */ }
      finally { setLoading(false); }
    };
    void load();
  }, []);

  // Typewriter effect — runs when content changes
  useEffect(() => {
    if (typeTimerRef.current) clearInterval(typeTimerRef.current);
    if (content === null) { setDisplayed(null); return; }
    setDisplayed('');
    let i = 0;
    const step = content.length > 4000 ? 8 : content.length > 1500 ? 3 : 1;
    const intervalMs = content.length > 4000 ? 4 : 6;
    typeTimerRef.current = setInterval(() => {
      i += step;
      if (i >= content.length) {
        setDisplayed(content);
        clearInterval(typeTimerRef.current!);
        typeTimerRef.current = null;
      } else {
        setDisplayed(content.slice(0, i));
      }
    }, intervalMs);
    return () => { if (typeTimerRef.current) clearInterval(typeTimerRef.current); };
  }, [content]);

  const openFile = async (file: MemFile) => {
    if (selected?.path === file.path) return;
    setSelected(file);
    setContent(null);
    setDisplayed(null);
    setFileLoading(true);
    soundEngine.hydraulicHiss();
    try {
      const r = await fetch(`/api/memory/file?path=${encodeURIComponent(file.path)}`);
      if (r.ok) {
        const data = await r.json() as { content: string };
        setContent(data.content);
      } else {
        setContent('[Error loading file]');
      }
    } catch {
      setContent('[Failed to load — gateway offline]');
    } finally {
      setFileLoading(false);
    }
  };

  const categories = ['all', ...Array.from(new Set(files.map(f => f.category)))];

  const filtered = files.filter(f => {
    const matchCat = catFilter === 'all' || f.category === catFilter;
    const matchText = !filter || f.name.toLowerCase().includes(filter.toLowerCase());
    return matchCat && matchText;
  });

  return (
    <div className="memory-browser">
      <AmbientBackground variant="green" density={0.5} seed={55} />
      {/* File list */}
      <div className="memory-browser__list" data-tour="memory-list">
        <div className="memory-browser__search">
          <input
            className="memory-search-input"
            placeholder="Filter files…"
            value={filter}
            onChange={e => setFilter(e.target.value)}
          />
        </div>

        <div className="memory-cat-tabs">
          {categories.map(cat => (
            <button
              key={cat}
              className={`memory-cat-btn${catFilter === cat ? ' memory-cat-btn--active' : ''}`}
              onClick={() => setCatFilter(cat)}
            >
              {cat.toUpperCase()}
            </button>
          ))}
        </div>

        {loading && (
          <div className="memory-status"><span className="cursor">█</span> LOADING…</div>
        )}

        {!loading && filtered.length === 0 && (
          <div className="memory-status" style={{ color: 'var(--amber-ghost)' }}>
            NO FILES FOUND
          </div>
        )}

        {filtered.map(file => (
          <button
            key={file.path}
            className={`memory-file-btn${selected?.path === file.path ? ' memory-file-btn--active' : ''}`}
            onClick={() => void openFile(file)}
          >
            <span className="memory-file-btn__name">{file.name}</span>
            <span className="memory-file-btn__meta">
              {formatSize(file.size)} · {formatAge(file.mtime)}
            </span>
          </button>
        ))}
      </div>

      {/* File viewer */}
      <div className="memory-browser__viewer" data-tour="memory-viewer">
        {!selected && (
          <div className="memory-viewer-empty">
            <span style={{ fontSize: 28, opacity: 0.25 }}>🧠</span>
            <span style={{ fontSize: 10, letterSpacing: '0.18em', color: 'var(--amber-ghost)' }}>
              SELECT A FILE TO VIEW
            </span>
          </div>
        )}

        {selected && (
          <>
            <div className="memory-viewer__header">
              <span className="memory-viewer__filename">{selected.name}</span>
              <span className="memory-viewer__meta">
                {selected.category} · {formatSize(selected.size)} · {formatAge(selected.mtime)}
              </span>
            </div>
            <div className="memory-viewer__content">
              {fileLoading && <div className="memory-status"><span className="cursor">█</span> LOADING…</div>}
              {!fileLoading && content !== null && (
                selected.name.endsWith('.md')
                  ? <MarkdownView content={displayed ?? ''} />
                  : (
                    <pre className="memory-raw">
                      {displayed ?? ''}
                      {displayed !== null && displayed.length < content.length && (
                        <span className="memory-type-cursor">█</span>
                      )}
                    </pre>
                  )
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
