import { useEffect, useRef } from 'react';

/**
 * Ambient particle canvas — murky amber/green nebula, inspired by the
 * Sector Map's PARTICLES + nebula glow. Positioned absolute, fills its
 * nearest positioned ancestor, pointer-events: none.
 */

const RM = typeof window !== 'undefined'
  ? window.matchMedia('(prefers-reduced-motion: reduce)').matches : false;

function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Particle {
  x: number; y: number;
  vx: number; vy: number;
  r: number; baseAlpha: number;
  tw: number; ph: number;
  col: string;
}

const COLS_MIXED  = ['rgba(255,176,0,1)', 'rgba(51,200,30,1)', 'rgba(200,140,0,1)', 'rgba(80,180,60,1)'];
const COLS_AMBER  = ['rgba(255,176,0,1)', 'rgba(200,140,0,1)', 'rgba(180,110,0,1)'];
const COLS_GREEN  = ['rgba(51,255,51,1)', 'rgba(30,180,30,1)', 'rgba(20,140,20,1)'];

function makeCols(variant: string) {
  if (variant === 'amber') return COLS_AMBER;
  if (variant === 'green') return COLS_GREEN;
  return COLS_MIXED;
}

function buildParticles(seed: number, count: number, cols: string[]): Particle[] {
  const rand = mulberry32(seed);
  return Array.from({ length: count }, () => ({
    x:         rand(),
    y:         rand(),
    vx:        (rand() - 0.5) * 0.00008,
    vy:        (rand() - 0.58) * 0.00006,
    r:         0.4 + rand() * 1.5,
    baseAlpha: 0.045 + rand() * 0.09,
    tw:        0.12 + rand() * 0.65,
    ph:        rand() * Math.PI * 2,
    col:       cols[Math.floor(rand() * cols.length)],
  }));
}

export interface AmbientBgProps {
  variant?: 'amber' | 'green' | 'mixed';
  density?: number;
  seed?: number;
}

export function AmbientBackground({ variant = 'mixed', density = 1, seed = 42 }: AmbientBgProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;

    const cols = makeCols(variant);
    const particles = buildParticles(seed, Math.round(55 * density), cols);
    let raf = 0;
    let last = performance.now();

    const loop = (now: number) => {
      const dt = Math.min(50, now - last) / 1000;
      last = now;

      const W = cv.clientWidth;
      const H = cv.clientHeight;
      if (W === 0 || H === 0) { raf = requestAnimationFrame(loop); return; }

      const dpr = window.devicePixelRatio || 1;
      const bw = Math.round(W * dpr);
      const bh = Math.round(H * dpr);
      if (cv.width !== bw || cv.height !== bh) {
        cv.width = bw;
        cv.height = bh;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);

      // Nebula glow — murky amber core, faint green outer
      const ng = ctx.createRadialGradient(W * 0.5, H * 0.42, 0, W * 0.5, H * 0.42, Math.max(W, H) * 0.6);
      ng.addColorStop(0,   'rgba(255,140,0,0.045)');
      ng.addColorStop(0.4, 'rgba(30,90,10,0.025)');
      ng.addColorStop(1,   'rgba(0,0,0,0)');
      ctx.fillStyle = ng;
      ctx.fillRect(0, 0, W, H);

      const t = now / 1000;
      particles.forEach(p => {
        if (!RM) {
          p.x += p.vx * dt * 60;
          p.y += p.vy * dt * 60;
          if (p.x < -0.02) p.x += 1.04;
          if (p.x > 1.02)  p.x -= 1.04;
          if (p.y < -0.02) p.y += 1.04;
          if (p.y > 1.02)  p.y -= 1.04;
        }
        const tw = RM ? 1 : 0.5 + 0.5 * Math.sin(t * p.tw + p.ph);
        ctx.save();
        ctx.globalAlpha = p.baseAlpha * tw;
        ctx.fillStyle = p.col;
        ctx.beginPath();
        ctx.arc(p.x * W, p.y * H, p.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      });

      raf = requestAnimationFrame(loop);
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [density, variant, seed]);

  return (
    <canvas
      ref={canvasRef}
      className="ambient-bg"
      aria-hidden="true"
    />
  );
}
