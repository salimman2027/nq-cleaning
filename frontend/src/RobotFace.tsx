import { useEffect, useRef, useState } from 'react';

/** A small robot whose eyes follow the pointer. When `alert` is on (a wrong entry) the eyes light up red and the head shakes. */
export function RobotFace({ alert = false, shakeKey = '', className = '' }: { alert?: boolean; shakeKey?: string; className?: string }) {
  const ref = useRef<SVGSVGElement>(null);
  const [look, setLook] = useState({ x: 0, y: 0 });

  useEffect(() => {
    let raf = 0;
    const move = (e: PointerEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const el = ref.current; if (!el) return;
        const r = el.getBoundingClientRect();
        const dx = e.clientX - (r.left + r.width / 2); const dy = e.clientY - (r.top + r.height / 2);
        const d = Math.hypot(dx, dy) || 1; const k = Math.min(1, d / 220);
        setLook({ x: (dx / d) * 7 * k, y: (dy / d) * 6 * k });
      });
    };
    window.addEventListener('pointermove', move);
    return () => { window.removeEventListener('pointermove', move); cancelAnimationFrame(raf); };
  }, []);

  const glow = alert ? '#ef4444' : '#fbbf24';
  return (
    <svg ref={ref} viewBox="0 0 200 200" role="img" aria-label={alert ? 'Something is wrong' : 'Assistant robot'} className={className}>
      <g key={shakeKey} className={alert ? 'robot-shake' : ''} style={{ transformOrigin: '100px 110px' }}>
        <line x1="100" y1="28" x2="100" y2="46" stroke="#94a3b8" strokeWidth="4" strokeLinecap="round" />
        <circle cx="100" cy="24" r="7" fill={glow} style={{ filter: `drop-shadow(0 0 6px ${glow})`, transition: 'fill .25s' }} />
        <rect x="22" y="92" width="14" height="40" rx="7" fill="#475569" />
        <rect x="164" y="92" width="14" height="40" rx="7" fill="#475569" />
        <rect x="34" y="46" width="132" height="116" rx="30" fill="#e2e8f0" />
        <rect x="34" y="46" width="132" height="116" rx="30" fill="none" stroke="#94a3b8" strokeWidth="3" />
        <rect x="48" y="62" width="104" height="66" rx="20" fill="#0b2455" />
        {[70, 130].map((cx) => (
          <g key={cx}>
            <circle cx={cx} cy="94" r="17" fill={alert ? '#450a0a' : '#13336e'} style={{ transition: 'fill .25s' }} />
            <circle cx={cx + look.x} cy={94 + look.y} r="9" fill={glow} style={{ filter: `drop-shadow(0 0 ${alert ? 9 : 5}px ${glow})`, transition: 'fill .25s, cx .12s ease-out, cy .12s ease-out' }} />
            <circle cx={cx + look.x - 3} cy={94 + look.y - 3} r="2.6" fill="#fff" opacity=".85" />
          </g>
        ))}
        {alert
          ? <path d="M82 148 q18 -10 36 0" fill="none" stroke="#ef4444" strokeWidth="5" strokeLinecap="round" />
          : <path d="M82 144 q18 12 36 0" fill="none" stroke="#475569" strokeWidth="5" strokeLinecap="round" />}
      </g>
    </svg>
  );
}
