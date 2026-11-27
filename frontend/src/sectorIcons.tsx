/** Line icons per sector (24x24, stroke only). Drawn for this project. */
const P: Record<string, string> = {
  cleaning: 'M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8zM18 15l.9 2.1L21 18l-2.1.9L18 21l-.9-2.1L15 18l2.1-.9z',
  plumbing: 'M12 3.5c3 3.8 5 6.4 5 9a5 5 0 01-10 0c0-2.6 2-5.2 5-9zM9.8 13.2a2.4 2.4 0 002.4 2.4',
  electrical: 'M13 2.5L5 13.5h6l-1 8 8-11h-6z',
  ac: 'M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9M9.5 4.5L12 7l2.5-2.5M9.5 19.5L12 17l2.5 2.5',
  pest_control: 'M12 8.5a3.5 4.5 0 013.5 4.5v1.5a3.5 4 0 01-7 0V13A3.5 4.5 0 0112 8.5zM9.5 6.5L8 4.5M14.5 6.5L16 4.5M8.5 12H5M15.5 12H19M8.5 16l-3 2M15.5 16l3 2',
  laundry: 'M8 4l-5 3 2 4 2-1v10h10V10l2 1 2-4-5-3a4 4 0 01-8 0z',
  maintenance: 'M14.5 5.5a4 4 0 00-5 5L4 16l4 4 5.5-5.5a4 4 0 005-5l-2.5 2.5-2.5-.5-.5-2.5z',
  moving: 'M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10',
};
export function SectorIcon({ code, className = 'h-6 w-6' }: { code: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d={P[code] ?? 'M4 12h16M12 4v16'} />
    </svg>
  );
}
