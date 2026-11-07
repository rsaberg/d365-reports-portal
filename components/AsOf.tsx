"use client";
import { useRouter, usePathname, useSearchParams } from "next/navigation";

export default function AsOf({ value, label = "As of" }: { value: string; label?: string }) {
  const router = useRouter(); const path = usePathname(); const sp = useSearchParams();
  return (
    <div className="grid gap-1">
      <label htmlFor="f-asof" className="label">{label}</label>
      <input id="f-asof" type="date" className="input" value={value}
        onChange={(e) => { if (!e.target.value) return; const q = new URLSearchParams(sp.toString()); q.set("asof", e.target.value); router.push(`${path}?${q}`); }} />
    </div>
  );
}
