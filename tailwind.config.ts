import type { Config } from "tailwindcss";
const v = (n: string) => `rgb(var(--${n}) / <alpha-value>)`;
export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: v("bg"), surface: v("surface"), sunken: v("sunken"), line: v("line"), ink: v("ink"), muted: v("muted"),
        accent: v("accent"), "accent-ink": v("accent-ink"), good: v("good"), warn: v("warn"), bad: v("bad"), nav: v("nav"), "nav-ink": v("nav-ink"),
      },
      fontFamily: {
        sans: ["'IBM Plex Sans'", "'IBM Plex Sans Arabic'", "Segoe UI", "system-ui", "sans-serif"],
        display: ["'Readex Pro'", "'IBM Plex Sans Arabic'", "system-ui", "sans-serif"],
        mono: ["'IBM Plex Mono'", "ui-monospace", "Consolas", "monospace"],
      },
    },
  },
  plugins: [],
} satisfies Config;
