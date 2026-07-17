import { useEffect, useState } from 'react';
import { soundEngine } from '../audio/SoundEngine';

interface Project {
  slug: string;
  source: string;
  // brief.json fields
  name?: string;
  businessName?: string;
  industry?: string;
  industryLabel?: string;
  tier?: number;
  status?: string;
  live_url?: string;
  deployment_url?: string;
  notes?: string;
  raw?: string;
  stack?: string;
  created?: string;
  delivered?: string;
  generatedAt?: string;
  phone?: string;
  city?: string;
  state?: string;
  ownerName?: string;
  owner?: string;
  rating?: number;
  reviewCount?: number;
  tagline?: string;
  qa?: { crit?: number; major?: number; minor?: number; scan?: string };
  location?: string;
  address?: string;
  license?: string;
  mapsUrl?: string;
  hours?: Record<string, string>;
  services?: string[];
}

const STATUS_COLOR: Record<string, string> = {
  live:      'var(--green)',
  delivered: 'var(--holo)',
  pitch:     'var(--amber)',
  built:     'var(--amber)',
  archived:  'var(--chrome-dark)',
};

const TIER_LABEL: Record<number, string> = { 1: 'T1', 2: 'T2', 3: 'T3' };
const TIER_COLOR: Record<number, string> = {
  1: 'var(--amber-dim)',
  2: 'var(--amber)',
  3: 'var(--holo)',
};

function projectName(p: Project) {
  return p.name ?? p.businessName ?? p.slug;
}

function projectStatus(p: Project) {
  return p.status ?? (p.live_url ? 'delivered' : 'built');
}

function ProjectCard({ project, active, onClick }: { project: Project; active: boolean; onClick: () => void }) {
  const status = projectStatus(project);
  const statusColor = STATUS_COLOR[status] ?? 'var(--amber-dim)';

  return (
    <button
      className={`proj-dir__card${active ? ' proj-dir__card--active' : ''}`}
      onClick={onClick}
    >
      <div className="proj-dir__card-name">{projectName(project)}</div>
      <div className="proj-dir__card-meta">
        <span className="proj-dir__industry">{project.industryLabel ?? project.industry ?? '—'}</span>
        {project.tier && (
          <span className="proj-dir__tier" style={{ color: TIER_COLOR[project.tier] }}>
            {TIER_LABEL[project.tier]}
          </span>
        )}
        <span className="proj-dir__status" style={{ color: statusColor }}>
          {status.toUpperCase()}
        </span>
      </div>
    </button>
  );
}

function ReportPanel({ project }: { project: Project }) {
  const status = projectStatus(project);
  const statusColor = STATUS_COLOR[status] ?? 'var(--amber-dim)';
  const name = projectName(project);
  const desc = project.notes ?? project.raw ?? project.tagline ?? null;

  return (
    <div className="proj-dir__report">
      {/* Header */}
      <div className="proj-dir__report-header">
        <div className="proj-dir__report-name">{name}</div>
        <div className="proj-dir__report-badges">
          {project.tier && (
            <span className="proj-dir__badge" style={{ color: TIER_COLOR[project.tier], borderColor: TIER_COLOR[project.tier] }}>
              TIER {project.tier}
            </span>
          )}
          <span className="proj-dir__badge" style={{ color: statusColor, borderColor: statusColor }}>
            {status.toUpperCase()}
          </span>
          <span className="proj-dir__badge" style={{ color: 'var(--phosphor-dim)', borderColor: 'var(--phosphor-dim)' }}>
            {project.source.toUpperCase()}
          </span>
        </div>
      </div>

      {/* Meta row */}
      <div className="proj-dir__report-meta">
        {project.industry && <span>⬡ {project.industryLabel ?? project.industry}</span>}
        {(project.city ?? project.location) && (
          <span>📍 {project.city ? `${project.city}${project.state ? `, ${project.state}` : ''}` : project.location}</span>
        )}
        {(project.ownerName ?? project.owner) && <span>👤 {project.ownerName ?? project.owner}</span>}
        {project.phone && <span>📞 {project.phone}</span>}
        {project.license && <span>🪪 {project.license}</span>}
        {project.rating != null && <span>⭐ {project.rating} ({project.reviewCount} reviews)</span>}
      </div>

      {/* Maps link */}
      {project.mapsUrl && (
        <a href={project.mapsUrl} target="_blank" rel="noopener noreferrer" className="proj-dir__maps-link"
          onClick={() => soundEngine.keyClack()}>
          ↗ GOOGLE MAPS
        </a>
      )}

      {/* Live URL */}
      {project.live_url && (
        <a
          href={project.live_url}
          target="_blank"
          rel="noopener noreferrer"
          className="proj-dir__launch-btn"
          onClick={() => soundEngine.commChirp()}
        >
          ↗ LAUNCH SITE
        </a>
      )}

      {/* Services */}
      {project.services && project.services.length > 0 && (
        <div className="proj-dir__report-section">
          <div className="proj-dir__report-label">SERVICES</div>
          <ul className="proj-dir__service-list">
            {project.services.map((s, i) => (
              <li key={i} className="proj-dir__service-item">▸ {s}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Hours */}
      {project.hours && (
        <div className="proj-dir__report-section">
          <div className="proj-dir__report-label">HOURS</div>
          <div className="proj-dir__hours-grid">
            {Object.entries(project.hours).map(([day, hrs]) => (
              <div key={day} className="proj-dir__hours-row">
                <span className="proj-dir__hours-day">{day.toUpperCase()}</span>
                <span className="proj-dir__hours-val">{hrs}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Stack */}
      {project.stack && (
        <div className="proj-dir__report-section">
          <div className="proj-dir__report-label">STACK</div>
          <div className="proj-dir__report-value">{project.stack}</div>
        </div>
      )}

      {/* Description / notes */}
      {desc && (
        <div className="proj-dir__report-section">
          <div className="proj-dir__report-label">BRIEF</div>
          <div className="proj-dir__report-body">{desc}</div>
        </div>
      )}

      {/* QA summary */}
      {project.qa && (
        <div className="proj-dir__report-section">
          <div className="proj-dir__report-label">QA</div>
          <div className="proj-dir__qa-row">
            <span className="proj-dir__qa-stat" style={{ color: project.qa.crit ? 'var(--alert)' : 'var(--green)' }}>
              {project.qa.crit ?? 0} CRIT
            </span>
            <span className="proj-dir__qa-stat" style={{ color: (project.qa.major ?? 0) > 0 ? 'var(--amber)' : 'var(--green)' }}>
              {project.qa.major ?? 0} MAJOR
            </span>
            <span className="proj-dir__qa-stat" style={{ color: 'var(--amber-dim)' }}>
              {project.qa.minor ?? 0} MINOR
            </span>
            {project.qa.scan && (
              <span className="proj-dir__qa-stat" style={{ color: project.qa.scan === 'PASS' ? 'var(--green)' : 'var(--alert)' }}>
                SCAN {project.qa.scan}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Dates */}
      {(project.created ?? project.generatedAt) && (
        <div className="proj-dir__report-section">
          <div className="proj-dir__report-label">DATES</div>
          <div className="proj-dir__report-value" style={{ fontSize: 10 }}>
            {project.created && <span>CREATED {new Date(project.created).toLocaleDateString()}</span>}
            {project.delivered && <span style={{ marginLeft: 12 }}>DELIVERED {new Date(project.delivered).toLocaleDateString()}</span>}
            {project.generatedAt && !project.created && <span>GENERATED {new Date(project.generatedAt).toLocaleDateString()}</span>}
          </div>
        </div>
      )}

      {/* Deployment URL (secondary) */}
      {project.deployment_url && (
        <div className="proj-dir__report-section">
          <div className="proj-dir__report-label">DEPLOY URL</div>
          <a
            href={project.deployment_url}
            target="_blank"
            rel="noopener noreferrer"
            className="proj-dir__deploy-link"
          >
            {project.deployment_url}
          </a>
        </div>
      )}
    </div>
  );
}

export function ProjectDirectory() {
  const [projects, setProjects]   = useState<Project[]>([]);
  const [loading, setLoading]     = useState(true);
  const [selected, setSelected]   = useState<Project | null>(null);
  const [filter, setFilter]       = useState<string>('all');

  useEffect(() => {
    fetch('/api/projects')
      .then(r => r.json() as Promise<Project[]>)
      .then(data => {
        // Sort: live first, then delivered, then others; archived last
        const ORDER: Record<string, number> = { live: 0, delivered: 1, pitch: 2, built: 3, archived: 9 };
        data.sort((a, b) => {
          const sa = ORDER[projectStatus(a)] ?? 5;
          const sb = ORDER[projectStatus(b)] ?? 5;
          return sa !== sb ? sa - sb : projectName(a).localeCompare(projectName(b));
        });
        setProjects(data);
        if (data.length > 0) setSelected(data[0]);
      })
      .catch(() => { /* backend offline */ })
      .finally(() => setLoading(false));
  }, []);

  const STATUS_FILTERS = ['all', 'live', 'delivered', 'pitch', 'archived'];

  const visible = filter === 'all'
    ? projects
    : projects.filter(p => projectStatus(p) === filter);

  return (
    <div className="proj-dir">
      {/* Filter bar */}
      <div className="proj-dir__filters">
        {STATUS_FILTERS.map(f => (
          <button
            key={f}
            className={`mission-filter-btn${filter === f ? ' mission-filter-btn--active' : ''}`}
            onClick={() => { setFilter(f); soundEngine.keyClack(); }}
          >
            {f.toUpperCase()}
          </button>
        ))}
        <span className="proj-dir__count">{visible.length} PROJECTS</span>
      </div>

      <div className="proj-dir__layout">
        {/* Left: scrollable directory list */}
        <div className="proj-dir__list">
          {loading && (
            <div className="ops-loading"><span className="cursor">█</span> LOADING…</div>
          )}
          {!loading && visible.length === 0 && (
            <div className="pipeline-empty">NO PROJECTS</div>
          )}
          {visible.map(p => (
            <ProjectCard
              key={p.slug}
              project={p}
              active={selected?.slug === p.slug}
              onClick={() => { setSelected(p); soundEngine.keyClack(); }}
            />
          ))}
        </div>

        {/* Right: business report */}
        <div className="proj-dir__detail">
          {selected
            ? <ReportPanel project={selected} />
            : <div className="pipeline-empty">SELECT A PROJECT</div>
          }
        </div>
      </div>
    </div>
  );
}
