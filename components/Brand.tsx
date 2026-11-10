/** ONE365 brand marks (same mark as ONE365 HR): orange tile with the growth line, "ONE365" + product word. */
export function One365Logo({ product = "Reports", size = 32, onDark }: { product?: string; size?: number; onDark?: boolean }) {
  // onDark undefined = follow the page theme
  const ink = onDark === undefined ? "currentColor" : onDark ? "#FFFFFF" : "#0B1F4B";
  const acc = onDark === undefined ? "rgb(var(--accent))" : onDark ? "#FF9E45" : "#E26A00";
  return (
    <span className="inline-flex items-center gap-2.5" aria-label={`ONE365 ${product}`}>
      <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true" className="shrink-0">
        <defs>
          <linearGradient id="o365g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#FF9E45" />
            <stop offset="1" stopColor="#F58220" />
          </linearGradient>
        </defs>
        <rect width="40" height="40" rx="11" fill="url(#o365g)" />
        <path d="M9 28c6 0 7.5-9 12-9s6 4.5 11-10" fill="none" stroke="#1B0D00" strokeWidth="3" strokeLinecap="round" />
        <circle cx="32" cy="9" r="2.6" fill="#1B0D00" />
      </svg>
      <span className="font-display font-bold leading-none tracking-[-.01em]" style={{ fontSize: size * 0.56, color: ink }}>
        ONE365 <span style={{ color: acc }}>{product}</span>
      </span>
    </span>
  );
}

export function GrowPathMark({ onDark = true, className = "" }: { onDark?: boolean; className?: string }) {
  return (
    <span className={`inline-flex flex-col leading-none ${className}`} aria-label="Grow Path">
      <span className="font-bold text-[15px]" style={{ color: onDark ? "#FFFFFF" : "#0B1F4B" }}>
        Grow <span style={{ color: onDark ? "#F58220" : "#E26A00" }}>Path</span>
      </span>
      <span className="text-[9.5px] mt-1" style={{ color: onDark ? "#9FB0CF" : "#4A5468" }}>Your Digital Partner</span>
    </span>
  );
}

export const BRAND = "ONE365 Reports";
