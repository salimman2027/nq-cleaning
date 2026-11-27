/** Small dependency-free SVG/CSS charts for the reports. Colours come from one palette; text stays in HTML so Arabic renders correctly. */
export const PALETTE = ['#0e7490', '#f59e0b', '#10b981', '#6366f1', '#ef4444', '#64748b'];

export function HBars({ items, format }: { items: { label: string; value: number }[]; format?: (n: number) => string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  const f = format ?? ((n: number) => String(n));
  return (
    <ul className="space-y-2">
      {items.map((i, k) => (
        <li key={`${i.label}-${k}`} className="text-sm">
          <div className="mb-1 flex justify-between gap-2"><span className="truncate">{i.label}</span><span className="font-semibold tabular-nums">{f(i.value)}</span></div>
          <div className="h-2.5 rounded-full bg-slate-100 dark:bg-slate-800"><div className="h-2.5 rounded-full" style={{ width: `${(i.value / max) * 100}%`, background: PALETTE[k % PALETTE.length] }} /></div>
        </li>
      ))}
    </ul>
  );
}

export function Donut({ parts, center }: { parts: { label: string; value: number; color?: string }[]; center?: string }) {
  const total = parts.reduce((a, p) => a + p.value, 0);
  const R = 42, C = 2 * Math.PI * R;
  let acc = 0;
  return (
    <div className="flex flex-wrap items-center gap-4">
      <svg viewBox="0 0 100 100" className="h-32 w-32 shrink-0 -rotate-90" role="img" aria-label={parts.map((p) => `${p.label}: ${p.value}`).join(', ')}>
        <circle cx="50" cy="50" r={R} fill="none" strokeWidth="14" className="stroke-slate-100 dark:stroke-slate-800" />
        {total > 0 && parts.map((p, k) => { const len = (p.value / total) * C; const el = <circle key={p.label} cx="50" cy="50" r={R} fill="none" strokeWidth="14" stroke={p.color ?? PALETTE[k % PALETTE.length]} strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-acc} />; acc += len; return el; })}
        {center && <text x="50" y="50" transform="rotate(90 50 50)" textAnchor="middle" dominantBaseline="central" className="fill-current text-[18px] font-bold">{center}</text>}
      </svg>
      <ul className="space-y-1 text-sm">{parts.map((p, k) => <li key={p.label} className="flex items-center gap-2"><span className="h-3 w-3 rounded-sm" style={{ background: p.color ?? PALETTE[k % PALETTE.length] }} />{p.label}<span className="ms-2 font-semibold tabular-nums">{p.value}</span></li>)}</ul>
    </div>
  );
}

/** Column chart over time. `points` are in date order; labels show the first, middle and last date. */
export function Columns({ points, color = PALETTE[0], format }: { points: { label: string; value: number }[]; color?: string; format?: (n: number) => string }) {
  const max = Math.max(1, ...points.map((p) => p.value));
  const f = format ?? ((n: number) => String(n));
  const W = 600, H = 150, gap = points.length > 45 ? 1 : 3, bw = Math.max(2, (W - gap * (points.length - 1)) / Math.max(points.length, 1));
  const ticks = points.length ? [0, Math.floor((points.length - 1) / 2), points.length - 1] : [];
  return (
    <div dir="ltr">
      <svg viewBox={`0 0 ${W} ${H + 4}`} className="w-full" role="img" aria-label={points.map((p) => `${p.label}: ${p.value}`).join(', ')} preserveAspectRatio="none">
        <line x1="0" x2={W} y1={H} y2={H} className="stroke-slate-300 dark:stroke-slate-700" />
        {points.map((p, i) => { const h = (p.value / max) * (H - 8); return <rect key={p.label} x={i * (bw + gap)} y={H - h} width={bw} height={h} rx="1.5" fill={color}><title>{`${p.label}: ${f(p.value)}`}</title></rect>; })}
      </svg>
      <div className="mt-1 flex justify-between text-[11px] text-slate-500"><span>{points[ticks[0]]?.label}</span><span>{points[ticks[1]]?.label}</span><span>{points[ticks[2]]?.label}</span></div>
      <div className="mt-1 text-end text-[11px] text-slate-500">max {f(max)}</div>
    </div>
  );
}
