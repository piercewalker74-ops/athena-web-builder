import { useEffect, useRef, useState } from 'react';
import { soundEngine } from '../audio/SoundEngine';
import type { NavPage } from './NavRail';

interface Command {
  id: string;
  label: string;
  description?: string;
  icon?: string;
  action: () => void;
  tags?: string[];
}

interface Props {
  open: boolean;
  onClose: () => void;
  onNavigate: (page: NavPage) => void;
}

export function CommandPalette({ open, onClose, onNavigate }: Props) {
  const [query, setQuery]     = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const commands: Command[] = [
    // Navigation
    { id: 'nav-comms',   label: 'Go to COMMS',      icon: '📡', tags: ['comms', 'chat'],      action: () => { onNavigate('comms');      onClose(); } },
    { id: 'nav-ops',     label: 'Go to OPERATIONS',  icon: '⚙️',  tags: ['ops', 'cron', 'auto'], action: () => { onNavigate('operations'); onClose(); } },
    { id: 'nav-pipe',    label: 'Go to PIPELINE',    icon: '🔁', tags: ['pipeline'],             action: () => { onNavigate('pipeline');   onClose(); } },
    { id: 'nav-inbox',   label: 'Go to INBOX',       icon: '📥', tags: ['inbox', 'review'],     action: () => { onNavigate('inbox');      onClose(); } },
    { id: 'nav-missions',label: 'Go to MISSION LOG', icon: '📋', tags: ['missions', 'log'],     action: () => { onNavigate('missions');   onClose(); } },
    { id: 'nav-memory',  label: 'Go to MEMORY',      icon: '🧠', tags: ['memory', 'files'],     action: () => { onNavigate('memory');     onClose(); } },

    // Actions
    { id: 'cron-refresh', label: 'Refresh Automations', icon: '↻', tags: ['cron', 'refresh'],
      action: () => { onNavigate('operations'); onClose(); }
    },
    { id: 'gateway-check', label: 'Check Gateway Status', icon: '📡', tags: ['gateway', 'status'],
      action: async () => {
        const r = await fetch('/api/gateway/status');
        const status = r.ok ? 'ONLINE' : 'OFFLINE';
        soundEngine.commChirp();
        alert(`Gateway: ${status}`);
        onClose();
      },
    },
    { id: 'clear-comms',  label: 'Clear COMMS History', icon: '🗑', tags: ['clear', 'chat'],
      action: () => { onNavigate('comms'); onClose(); }
    },

    // Links
    { id: 'openclaw-docs', label: 'OpenClaw Docs',     icon: '📚', tags: ['docs'],
      action: () => { window.open('https://docs.openclaw.ai', '_blank'); onClose(); }
    },
    { id: 'htb',  label: 'HackTheBox',                  icon: '🏴', tags: ['ctf', 'htb'],
      action: () => { window.open('https://hackthebox.com', '_blank'); onClose(); }
    },
    { id: 'thm',  label: 'TryHackMe',                   icon: '🎯', tags: ['ctf', 'thm'],
      action: () => { window.open('https://tryhackme.com', '_blank'); onClose(); }
    },
  ];

  const filtered = query
    ? commands.filter(c =>
        c.label.toLowerCase().includes(query.toLowerCase()) ||
        c.tags?.some(t => t.includes(query.toLowerCase())) ||
        c.description?.toLowerCase().includes(query.toLowerCase())
      )
    : commands;

  useEffect(() => {
    setSelected(0);
  }, [query]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setSelected(0);
      setTimeout(() => inputRef.current?.focus(), 50);
      soundEngine.hydraulicHiss();
    }
  }, [open]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!open) return;
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelected(s => Math.min(s + 1, filtered.length - 1)); }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSelected(s => Math.max(s - 1, 0)); }
      if (e.key === 'Enter') {
        e.preventDefault();
        const cmd = filtered[selected];
        if (cmd) { void Promise.resolve(cmd.action()); soundEngine.keyClack(); }
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose, filtered, selected]);

  if (!open) return null;

  return (
    <div className="palette-overlay" onClick={onClose}>
      <div className="palette" onClick={e => e.stopPropagation()} role="dialog" aria-label="Command palette">
        <div className="palette__input-row">
          <span className="palette__prompt">&gt;</span>
          <input
            ref={inputRef}
            className="palette__input"
            placeholder="TYPE A COMMAND…"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
          <span className="palette__esc">ESC</span>
        </div>

        <div className="palette__results">
          {filtered.length === 0 && (
            <div className="palette__empty">NO COMMANDS FOUND</div>
          )}
          {filtered.map((cmd, i) => (
            <button
              key={cmd.id}
              className={`palette__item${i === selected ? ' palette__item--selected' : ''}`}
              onClick={() => { void Promise.resolve(cmd.action()); soundEngine.keyClack(); }}
              onMouseEnter={() => setSelected(i)}
            >
              {cmd.icon && <span className="palette__item-icon">{cmd.icon}</span>}
              <span className="palette__item-label">{cmd.label}</span>
              {cmd.description && (
                <span className="palette__item-desc">{cmd.description}</span>
              )}
            </button>
          ))}
        </div>

        <div className="palette__footer">
          <span>↑↓ navigate</span>
          <span>↵ execute</span>
          <span>esc dismiss</span>
        </div>
      </div>
    </div>
  );
}
