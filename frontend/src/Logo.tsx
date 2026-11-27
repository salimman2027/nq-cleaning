/** Platform mark: the letter ف with a spark as its dot. Same artwork as /logo.svg. */
export function LogoMark({ className = 'h-9 w-9' }: { className?: string }) {
  return <img src="/logo.svg" alt="" className={`${className} shrink-0`} />;
}
