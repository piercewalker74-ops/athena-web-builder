import { useEffect, useState } from 'react';
import { BuildTracker } from './BuildTracker';
import { PipelineBoard } from './PipelineBoard';
import { ProjectsView } from './ProjectsView';
import { soundEngine } from '../audio/SoundEngine';

interface Props { onModeChange?: (projects: boolean) => void; }

/**
 * The pipeline section has two modes:
 *  - PIPELINE  — the live BuildTracker radar + the kanban board.
 *  - PROJECTS  — the Feature Director takeover (edit any built site). In this mode
 *    the large BuildTracker is unmounted; the movable mini tracker (global overlay)
 *    stays visible so a running circuit is still trackable.
 */
export function PipelineSection({ onModeChange }: Props) {
  const [mode, setMode] = useState<'pipeline' | 'projects'>('pipeline');

  useEffect(() => { onModeChange?.(mode === 'projects'); }, [mode, onModeChange]);
  useEffect(() => () => onModeChange?.(false), [onModeChange]);  // reset when leaving the section

  if (mode === 'projects') {
    return (
      <div className="pipeline-page pipeline-page--projects">
        <ProjectsView onExit={() => { setMode('pipeline'); soundEngine.hydraulicHiss(); }} />
      </div>
    );
  }

  return (
    <div className="pipeline-page">
      <div className="pl-modebar" data-tour="pipeline-modebar">
        <button className="mission-filter-btn mission-filter-btn--active">◉ PIPELINE</button>
        <button className="mission-filter-btn" onClick={() => { setMode('projects'); soundEngine.keyClack(); }}>
          ▣ PROJECTS
        </button>
      </div>
      <BuildTracker />
      <PipelineBoard />
    </div>
  );
}
