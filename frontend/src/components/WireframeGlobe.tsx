import { useEffect, useRef } from 'react';

interface Props {
  size?: number;
  color?: string;
  speed?: number;
  onClick?: () => void;
  active?: boolean;
}

// Globe geometry helpers
function spherePoint(lat: number, lon: number, r: number): [number, number, number] {
  const phi   = (90 - lat) * (Math.PI / 180);
  const theta = (lon + 180) * (Math.PI / 180);
  return [
    -r * Math.sin(phi) * Math.cos(theta),
     r * Math.cos(phi),
     r * Math.sin(phi) * Math.sin(theta),
  ];
}

function project(
  x: number, y: number, z: number,
  cx: number, cy: number, fov: number,
): [number, number, number] {
  const scale = fov / (fov + z);
  return [cx + x * scale, cy + y * scale, scale];
}

export function WireframeGlobe({ size = 200, color = '#00c8ff', speed = 0.4, onClick, active = false }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef   = useRef<number>(0);
  const angleRef  = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const cx = size / 2;
    const cy = size / 2;
    const r  = size * 0.38;
    const fov = size * 1.2;

    // Latitude/longitude lines
    const latLines: Array<Array<[number, number, number]>> = [];
    const lonLines: Array<Array<[number, number, number]>> = [];

    for (let lat = -75; lat <= 75; lat += 15) {
      const pts: Array<[number, number, number]> = [];
      for (let lon = -180; lon <= 180; lon += 5) pts.push(spherePoint(lat, lon, r));
      latLines.push(pts);
    }

    for (let lon = -180; lon <= 180; lon += 20) {
      const pts: Array<[number, number, number]> = [];
      for (let lat = -90; lat <= 90; lat += 5) pts.push(spherePoint(lat, lon, r));
      lonLines.push(pts);
    }

    const hexColor = color;
    const ghostColor = hexColor.replace(')', ', 0.18)').replace('rgb', 'rgba').replace('#', '');
    const dimColor = `rgba(0,200,255,0.18)`;
    const brightColor = hexColor;

    const draw = () => {
      ctx.clearRect(0, 0, size, size);

      // Pulsing glow behind globe
      if (active) {
        const grad = ctx.createRadialGradient(cx, cy, r * 0.5, cx, cy, r * 1.2);
        grad.addColorStop(0, 'rgba(0,200,255,0.07)');
        grad.addColorStop(1, 'rgba(0,200,255,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, r * 1.2, 0, Math.PI * 2);
        ctx.fill();
      }

      const cosA = Math.cos(angleRef.current);
      const sinA = Math.sin(angleRef.current);

      // Rotate and project points
      const rotate = ([x, y, z]: [number, number, number]): [number, number, number] => [
        x * cosA - z * sinA,
        y,
        x * sinA + z * cosA,
      ];

      const drawLines = (lines: Array<Array<[number, number, number]>>, alpha: number) => {
        for (const line of lines) {
          ctx.beginPath();
          let first = true;
          for (const pt of line) {
            const rotated = rotate(pt);
            const [px, py, scale] = project(...rotated, cx, cy, fov);
            const visible = rotated[2] > -r * 0.1; // back-face cull
            const lineAlpha = alpha * Math.max(0, (rotated[2] + r) / (2 * r));
            ctx.strokeStyle = `rgba(0,200,255,${lineAlpha.toFixed(3)})`;
            if (first || !visible) {
              ctx.moveTo(px, py);
              first = false;
            } else {
              ctx.lineTo(px, py);
            }
          }
          ctx.stroke();
        }
      };

      ctx.lineWidth = 0.8;
      drawLines(latLines, active ? 0.6 : 0.35);
      drawLines(lonLines, active ? 0.5 : 0.28);

      // Poles
      const north = rotate(spherePoint(90, 0, r));
      const south = rotate(spherePoint(-90, 0, r));
      for (const pole of [north, south]) {
        if (pole[2] > 0) {
          const [px, py] = project(...pole, cx, cy, fov);
          ctx.beginPath();
          ctx.arc(px, py, 3, 0, Math.PI * 2);
          ctx.fillStyle = active ? brightColor : dimColor;
          ctx.fill();
        }
      }

      // Equator highlight
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      let eFirst = true;
      for (let lon = -180; lon <= 180; lon += 3) {
        const pt = rotate(spherePoint(0, lon, r));
        const [px, py] = project(...pt, cx, cy, fov);
        if (pt[2] > 0) {
          if (eFirst) { ctx.moveTo(px, py); eFirst = false; }
          else ctx.lineTo(px, py);
        } else {
          eFirst = true;
        }
      }
      ctx.strokeStyle = active ? 'rgba(0,200,255,0.7)' : 'rgba(0,200,255,0.3)';
      ctx.stroke();
    };

    const tick = () => {
      angleRef.current += (speed * Math.PI / 180) * 0.016;
      draw();
      animRef.current = requestAnimationFrame(tick);
    };

    animRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animRef.current);
  }, [size, color, speed, active]);

  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      className={`wireframe-globe${active ? ' wireframe-globe--active' : ''}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => e.key === 'Enter' && onClick() : undefined}
      aria-label="Cybersec Deck — click to enter"
      style={{ cursor: onClick ? 'pointer' : 'default' }}
    />
  );
}
