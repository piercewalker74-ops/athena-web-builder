import { useCallback, useEffect, useState } from 'react';
import { soundEngine } from '../audio/SoundEngine';
import { AmbientBackground } from './AmbientBackground';

// ─── Types (mirror backend) ────────────────────────────────────────────────────
type WebStatus = 'none' | 'weak_template' | 'weak_social' | 'weak_booking' | 'weak_parked' | 'has_site' | 'unknown';
type PipelineStatus = 'scraped' | 'verifying' | 'qualified' | 'dropped' | 'approved' | 'building' | 'deployed' | 'reported' | 'delivered';

interface Lead {
  id: string;
  businessName: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  industry: string;
  mapsUrl?: string;
  rating: number;
  reviewCount: number;
  lastReviewDate?: string;
  webStatus: WebStatus;
  currentSiteUrl?: string;
  currentSiteType?: string;
  ownerName?: string;
  facebookUrl?: string;
  instagramUrl?: string;
  qualifyingSignals: string[];
  disqualifyingReasons: string[];
  qualificationScore: number;
  status: PipelineStatus;
  siteUrl?: string;
  updatedAt: number;
  notes?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function webStatusBadge(status: WebStatus, siteType?: string) {
  const labels: Record<WebStatus, { label: string; color: string }> = {
    'none':           { label: 'NO SITE',        color: 'var(--green)' },
    'weak_template':  { label: `WEAK — ${siteType ?? 'Template'}`, color: 'var(--amber)' },
    'weak_social':    { label: `WEAK — ${siteType ?? 'Social'}`,   color: 'var(--amber)' },
    'weak_booking':   { label: `WEAK — ${siteType ?? 'Booking'}`,  color: 'var(--amber)' },
    'weak_parked':    { label: `WEAK — Parked`,  color: 'var(--amber-dim)' },
    'has_site':       { label: 'HAS SITE',        color: 'var(--alert)' },
    'unknown':        { label: 'UNKNOWN',         color: 'var(--chrome)' },
  };
  return labels[status] ?? { label: status.toUpperCase(), color: 'var(--chrome)' };
}

function scoreColor(score: number): string {
  if (score >= 80) return 'var(--green)';
  if (score >= 65) return 'var(--holo)';
  if (score >= 50) return 'var(--amber)';
  return 'var(--alert)';
}

// ─── Build log drawer ─────────────────────────────────────────────────────────
function BuildLog({ logs, onClose }: { logs: string[]; onClose: () => void }) {
  return (
    <div className="build-log">
      <div className="build-log__header">
        <span className="section-header">BUILD LOG</span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--chrome)', cursor: 'pointer', fontSize: 12 }}>✕</button>
      </div>
      <div className="build-log__body">
        {logs.map((line, i) => (
          <div key={i} className="build-log__line">&gt; {line}</div>
        ))}
        <span className="cursor">█</span>
      </div>
    </div>
  );
}

// ─── Real-media puller (Google listing photos + YouTube gallery videos) ────────
interface PhotoManifest { count: number; displayName?: string; rating?: number; photos: Array<{ file: string; attribution?: Array<{ displayName?: string }> }>; }
interface YtManifest { count: number; channelTitle?: string; videos: Array<{ videoId: string; title: string; thumbnail: string; watchUrl: string }>; }

function LeadAssets({ leadId }: { leadId: string }) {
  const [photos, setPhotos]   = useState<PhotoManifest | null>(null);
  const [pPull, setPPull]     = useState(false);
  const [pErr, setPErr]       = useState('');
  const [chan, setChan]       = useState('');
  const [yt, setYt]           = useState<YtManifest | null>(null);
  const [yPull, setYPull]     = useState(false);
  const [yErr, setYErr]       = useState('');

  const pullPhotos = async () => {
    setPPull(true); setPErr('');
    try {
      const r = await fetch(`/api/pipeline/leads/${leadId}/photos`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const d = await r.json() as { ok: boolean; manifest?: PhotoManifest; error?: string };
      if (d.ok && d.manifest && d.manifest.count > 0) { setPhotos(d.manifest); soundEngine.motionPing(); }
      else setPErr(d.error ? d.error.slice(0, 120) : 'no listing photos found');
    } catch { setPErr('request failed'); } finally { setPPull(false); }
  };

  const pullYt = async () => {
    if (!chan.trim()) return;
    setYPull(true); setYErr('');
    try {
      const r = await fetch(`/api/pipeline/leads/${leadId}/youtube`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channel: chan.trim() }) });
      const d = await r.json() as { ok: boolean; manifest?: YtManifest; error?: string };
      if (d.ok && d.manifest && d.manifest.count > 0) { setYt(d.manifest); soundEngine.motionPing(); }
      else setYErr(d.error ? d.error.slice(0, 120) : 'no videos found');
    } catch { setYErr('request failed'); } finally { setYPull(false); }
  };

  const credit = photos?.photos?.[0]?.attribution?.[0]?.displayName;

  return (
    <div className="lead-card__assets" style={{ borderTop: '1px solid var(--grid, rgba(255,255,255,0.08))', marginTop: 8, paddingTop: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button className="lead-action-btn" style={{ borderColor: 'var(--holo)', color: 'var(--holo)' }} disabled={pPull} onClick={pullPhotos}>
          {pPull ? '◌ PULLING…' : photos ? '↻ RE-PULL PHOTOS' : '📸 PULL PHOTOS'}
        </button>
        {photos && <span style={{ fontSize: 9, color: 'var(--green)', letterSpacing: '0.08em' }}>{photos.count} REAL · GOOGLE LISTING</span>}
        {pErr && <span style={{ fontSize: 9, color: 'var(--alert)' }}>{pErr}</span>}
      </div>
      {photos && (
        <>
          <div style={{ display: 'flex', gap: 4, overflowX: 'auto', marginTop: 6, paddingBottom: 4 }}>
            {photos.photos.map((p) => (
              <img key={p.file} src={`/api/pipeline/leads/${leadId}/photos/${p.file}`} alt=""
                style={{ height: 56, width: 84, objectFit: 'cover', border: '1px solid var(--grid, rgba(255,255,255,0.1))', flex: '0 0 auto', borderRadius: 2 }} />
            ))}
          </div>
          {credit && <div style={{ fontSize: 8, color: 'var(--chrome)', letterSpacing: '0.06em' }}>Photos via Google · {credit} · swappable</div>}
        </>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
        <input value={chan} onChange={e => setChan(e.target.value)} placeholder="YouTube channel URL / @handle (optional)"
          style={{ flex: '1 1 180px', minWidth: 140, background: 'var(--panel, rgba(0,0,0,0.3))', border: '1px solid var(--grid, rgba(255,255,255,0.12))', color: 'var(--text, #cde)', fontSize: 10, padding: '4px 6px', fontFamily: 'inherit' }} />
        <button className="lead-action-btn" style={{ borderColor: 'var(--alert)', color: 'var(--alert)' }} disabled={yPull || !chan.trim()} onClick={pullYt}>
          {yPull ? '◌ …' : '▶ PULL VIDEOS'}
        </button>
        {yt && <span style={{ fontSize: 9, color: 'var(--green)', letterSpacing: '0.08em' }}>{yt.count} VIDEOS</span>}
        {yErr && <span style={{ fontSize: 9, color: 'var(--alert)' }}>{yErr}</span>}
      </div>
      {yt && (
        <div style={{ display: 'flex', gap: 4, overflowX: 'auto', marginTop: 6, paddingBottom: 4 }}>
          {yt.videos.map(v => (
            <a key={v.videoId} href={v.watchUrl} target="_blank" rel="noopener noreferrer" title={v.title} style={{ flex: '0 0 auto', position: 'relative' }}>
              <img src={v.thumbnail} alt="" style={{ height: 56, width: 96, objectFit: 'cover', border: '1px solid var(--grid, rgba(255,255,255,0.1))', borderRadius: 2 }} />
              <span style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#fff', fontSize: 16, textShadow: '0 0 4px #000' }}>▶</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Lead card ────────────────────────────────────────────────────────────────
function LeadCard({ lead, onApprove, onDrop, onBuild, onNote }: {
  lead: Lead;
  onApprove: (id: string) => void;
  onDrop:    (id: string, reason: string) => void;
  onBuild:   (id: string) => void;
  onNote:    (id: string, note: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const webBadge = webStatusBadge(lead.webStatus, lead.currentSiteType);

  return (
    <div className={`lead-card lead-card--${lead.status}`} onClick={() => setExpanded(e => !e)}>
      {/* Header row */}
      <div className="lead-card__header">
        <div className="lead-card__title-group">
          <span className="lead-card__name">{lead.businessName}</span>
          <span className="lead-card__location">{lead.city}, {lead.state}</span>
        </div>

        <div className="lead-card__badges">
          <span className="lead-badge" style={{ color: webBadge.color, borderColor: webBadge.color }}>
            {webBadge.label}
          </span>
          <span className="lead-score" style={{ color: scoreColor(lead.qualificationScore) }}>
            {lead.qualificationScore}
          </span>
        </div>
      </div>

      {/* Quick stats */}
      <div className="lead-card__stats">
        <span>⭐ {lead.rating} ({lead.reviewCount})</span>
        <span>📞 {lead.phone}</span>
        {lead.ownerName && <span>👤 {lead.ownerName}</span>}
        <span className="lead-card__industry">{lead.industry}</span>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="lead-card__detail" onClick={e => e.stopPropagation()}>
          {/* Signals */}
          {lead.qualifyingSignals.length > 0 && (
            <div className="lead-card__signals">
              {lead.qualifyingSignals.map((s, i) => (
                <div key={i} className="lead-signal lead-signal--green">✓ {s}</div>
              ))}
            </div>
          )}

          {/* Social links */}
          {(lead.facebookUrl || lead.instagramUrl || lead.mapsUrl) && (
            <div className="lead-card__links">
              {lead.mapsUrl && <a href={lead.mapsUrl} target="_blank" rel="noopener noreferrer" className="lead-link">Maps ↗</a>}
              {lead.facebookUrl && <a href={lead.facebookUrl} target="_blank" rel="noopener noreferrer" className="lead-link">FB ↗</a>}
              {lead.instagramUrl && <a href={lead.instagramUrl} target="_blank" rel="noopener noreferrer" className="lead-link">IG ↗</a>}
              {lead.currentSiteUrl && <a href={lead.currentSiteUrl} target="_blank" rel="noopener noreferrer" className="lead-link">Old Site ↗</a>}
            </div>
          )}

          {/* Deployed site */}
          {lead.siteUrl && (
            <div className="lead-card__deployed">
              <span style={{ color: 'var(--green)', fontSize: 9, letterSpacing: '0.1em' }}>DEPLOYED →</span>
              <a href={lead.siteUrl} target="_blank" rel="noopener noreferrer" className="lead-link lead-link--holo">
                {lead.siteUrl}
              </a>
            </div>
          )}

          {/* Notes */}
          {lead.notes && (
            <div className="lead-card__notes">{lead.notes}</div>
          )}

          {/* Action buttons */}
          <div className="lead-card__actions">
            {lead.status === 'qualified' && (
              <>
                <button
                  className="lead-action-btn lead-action-btn--approve"
                  onClick={() => { onApprove(lead.id); soundEngine.motionPing(); }}
                >
                  ✓ APPROVE BUILD
                </button>
                <button
                  className="lead-action-btn lead-action-btn--drop"
                  onClick={() => { onDrop(lead.id, 'Manual drop'); soundEngine.klaxon(); }}
                >
                  ✗ DROP LEAD
                </button>
              </>
            )}
            {lead.status === 'approved' && (
              <button
                className="lead-action-btn lead-action-btn--build"
                onClick={() => { onBuild(lead.id); }}
              >
                🚀 BUILD & DEPLOY
              </button>
            )}
            {lead.status === 'deployed' && (
              <span className="lead-card__deployed-badge">✓ SITE LIVE</span>
            )}
          </div>

          {/* Real media — pull the business's actual Google listing photos + YouTube videos */}
          <LeadAssets leadId={lead.id} />
        </div>
      )}
    </div>
  );
}

// ─── Main ReviewInbox ─────────────────────────────────────────────────────────
export function ReviewInbox() {
  const [leads, setLeads]       = useState<Lead[]>([]);
  const [loading, setLoading]   = useState(true);
  const [buildLogs, setBuildLogs] = useState<string[]>([]);
  const [buildTarget, setBuildTarget] = useState<string | null>(null);

  const loadLeads = useCallback(async () => {
    try {
      const r = await fetch('/api/pipeline/leads/inbox');
      if (r.ok) {
        const data = await r.json() as { leads: Lead[] };
        setLeads(data.leads ?? []);
      }
    } catch { /* backend not ready */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void loadLeads(); }, [loadLeads]);
  // Auto-refresh so a running circuit's leads appear without a manual click.
  useEffect(() => {
    const iv = setInterval(() => void loadLeads(), 30_000);
    return () => clearInterval(iv);
  }, [loadLeads]);

  const handleApprove = async (id: string) => {
    await fetch(`/api/pipeline/leads/${id}/approve`, { method: 'POST' });
    void loadLeads();
  };

  const handleDrop = async (id: string, reason: string) => {
    await fetch(`/api/pipeline/leads/${id}/drop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    });
    void loadLeads();
  };

  const handleBuild = async (id: string) => {
    setBuildTarget(id);
    setBuildLogs(['Initializing build…']);
    soundEngine.hydraulicHiss();

    const response = await fetch(`/api/pipeline/leads/${id}/build`, { method: 'POST' });
    if (!response.body) return;

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6);
        if (payload === '[DONE]') { void loadLeads(); break; }
        try {
          const { msg } = JSON.parse(payload) as { msg: string };
          setBuildLogs(prev => [...prev, msg]);
          if (msg.includes('Deployed')) soundEngine.motionPing();
          if (msg.includes('Report sent')) soundEngine.commChirp();
        } catch { /* skip */ }
      }
    }
  };

  const handleNote = async (id: string, note: string) => {
    await fetch(`/api/pipeline/leads/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: note }),
    });
    void loadLeads();
  };

  return (
    <div className="review-inbox">
      <AmbientBackground variant="amber" density={0.5} seed={33} />
      {/* Header */}
      <div className="review-inbox__header" data-tour="inbox-header">
        <div className="section-header">REVIEW INBOX</div>
        <span className="review-inbox__count">{leads.length} LEADS</span>
        <button className="ops-refresh" onClick={() => { void loadLeads(); }}>↻ REFRESH</button>
      </div>

      {/* Content */}
      <div className="review-inbox__content">
        <div className="review-inbox__leads" data-tour="inbox-leads">
          {loading && <div className="ops-loading"><span className="cursor">█</span> LOADING LEADS…</div>}

          {!loading && leads.length === 0 && (
            <div className="inbox-empty">
              <div className="inbox-empty__rings" aria-hidden="true" />
              <div className="inbox-empty__icon" aria-hidden="true">📥</div>
              <div className="inbox-empty__title">INBOX CLEAR</div>
              <div className="inbox-empty__sub">NO QUALIFIED LEADS PENDING REVIEW</div>
              <div className="inbox-empty__hint">
                Run <code>neoform-research</code> to populate the queue
              </div>
            </div>
          )}

          {leads.map(lead => (
            <LeadCard
              key={lead.id}
              lead={lead}
              onApprove={(id) => void handleApprove(id)}
              onDrop={(id, reason) => void handleDrop(id, reason)}
              onBuild={(id) => void handleBuild(id)}
              onNote={(id, note) => void handleNote(id, note)}
            />
          ))}
        </div>

        {/* Build log side panel */}
        {buildTarget && buildLogs.length > 0 && (
          <BuildLog
            logs={buildLogs}
            onClose={() => { setBuildTarget(null); setBuildLogs([]); }}
          />
        )}
      </div>
    </div>
  );
}
