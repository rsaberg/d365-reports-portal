"use client";
import { useRouter, usePathname, useSearchParams } from "next/navigation";

export default function Basis({ value }: { value: "due" | "trans" }) {
  const router = useRouter(); const path = usePathname(); const sp = useSearchParams();
  const go = (v: string) => { const q = new URLSearchParams(sp.toString()); q.set("basis", v); router.push(`${path}?${q}`); };
  return (
    <div className="grid gap-1">
      <span className="label" id="basis-l">Aged by</span>
      <div className="flex gap-1" role="group" aria-labelledby="basis-l">
        <button type="button" aria-pressed={value === "due"} className={`btn ${value === "due" ? "btn-primary" : ""}`} onClick={() => go("due")}>Due date</button>
        <button type="button" aria-pressed={value === "trans"} className={`btn ${value === "trans" ? "btn-primary" : ""}`} onClick={() => go("trans")}>Transaction date</button>
      </div>
    </div>
  );
}
