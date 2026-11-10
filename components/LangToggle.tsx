"use client";
/** Switches the portal between English and Arabic (cookie "lang"), then reloads. */
export default function LangToggle({ lang }: { lang: string }) {
  const set = (l: string) => { document.cookie = `lang=${l}; path=/; max-age=31536000; samesite=lax`; location.reload(); };
  return (
    <button type="button" className="btn" data-no-tr onClick={() => set(lang === "ar" ? "en" : "ar")} title={lang === "ar" ? "English" : "العربية"}>
      {lang === "ar" ? "English" : "عربي"}
    </button>
  );
}
