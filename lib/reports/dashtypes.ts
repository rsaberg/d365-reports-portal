/* Module dashboard spec (rendered by components/dash.tsx in the layout of the sales dashboard). */
export type Fmt = "money" | "int" | "pct" | "days" | "num";
export type Icon = "money" | "cart" | "profit" | "pie" | "tag" | "ret" | "box" | "truck" | "clock" | "check" | "alert" | "users" | "bank" | "doc" | "factory";
export interface TileSpec { label: string; value: number; fmt: Fmt; prev?: number | null; icon: Icon; href?: string; note?: string }
export type Body =
  | { kind: "trend"; data: { m: string; a: number; b?: number }[]; a: string; b?: string; money?: boolean }
  | { kind: "donut"; data: { label: string; value: number }[]; money?: boolean; centerLabel: string; center?: string }
  | { kind: "rank"; data: { label: string; value: number }[]; money?: boolean }
  | { kind: "bucket"; data: { label: string; value: number; color: string }[]; money?: boolean }
  | { kind: "pair"; data: Record<string, any>[]; a: { key: string; name: string }; b: { key: string; name: string }; money?: boolean }
  | { kind: "bars"; cols: [string, string?, string?]; rows: { a: string; b?: string; value: number }[] }
  | { kind: "table"; head: string[]; rows: (string | number)[][] }
  | { kind: "pctline"; data: { m: string; v: number }[]; name: string }
  | { kind: "chips"; items: { label: string; value: string }[] };
export interface StatSpec { label: string; value: string; tone?: "good" | "bad" }
export interface CardSpec { title: string; link?: { href: string; label: string }; stats?: StatSpec[]; body?: Body; more?: { label: string; body: Body }[]; wide?: boolean }
export interface DashSpec { tiles: TileSpec[]; cards: CardSpec[]; strip?: { label: string; value: string }[]; note?: string }
