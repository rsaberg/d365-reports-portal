import "server-only";
import { computeKpis, type KpiValue } from "./metrics";
import { type SiScope } from "./scope";
import * as S from "./screens";
import type { Screen } from "@/components/si/View";
import type { Grain } from "./time";

/** Route slug → default grain + screen builder. One registry serves the pages and the read-only API. */
export const ROUTES: Record<string, { grain?: Grain; build: (s: SiScope, k: Map<string, KpiValue>) => Promise<Screen> | Screen; needsKpis?: boolean }> = {
  "": { grain: "month", build: (s, k) => S.timeDashboard(s, k, "exec") },
  daily: { grain: "day", build: (s, k) => S.timeDashboard(s, k, "day") },
  weekly: { grain: "week", build: (s, k) => S.timeDashboard(s, k, "week") },
  monthly: { grain: "month", build: (s, k) => S.timeDashboard(s, k, "month") },
  quarterly: { grain: "quarter", build: (s, k) => S.timeDashboard(s, k, "quarter") },
  yearly: { grain: "year", build: (s, k) => S.timeDashboard(s, k, "year") },
  pvm: { build: S.pvmScreen }, targets: { build: S.targetScreen }, orders: { build: S.ordersScreen }, fulfilment: { build: S.fulfilmentScreen },
  invoices: { build: S.invoicesScreen }, customer: { build: (s, k) => S.customerScreen(s, k, computeKpis) }, customers: { build: S.customersScreen },
  products: { build: S.productsScreen }, pricing: { build: S.pricingScreen }, margin: { build: S.marginScreen }, team: { build: S.teamScreen },
  returns: { build: S.returnsScreen }, ar: { build: S.arScreen }, recon: { build: S.reconScreen, needsKpis: false },
  kpis: { build: S.kpiScreen }, reports: { build: S.reportsScreen, needsKpis: false }, health: { build: S.healthScreen, needsKpis: false },
};
