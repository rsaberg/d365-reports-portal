import json
import sys
# usage: python3 scripts/parse-si-spec.py <spec.md> si-spec.json && python3 scripts/gen-si-catalog.py si-spec.json
d=json.load(open(sys.argv[1] if len(sys.argv) > 1 else 'si-spec.json'))
IMPL=set("""REV-001 REV-002 REV-003 REV-004 REV-005 REV-006 REV-007 REV-008 REV-009 REV-010 REV-011 REV-012 REV-013 REV-014 REV-015
TAR-001 TAR-002 TAR-003 TAR-004 TAR-005 TAR-006 TAR-007 TAR-008 TAR-011 TAR-012
ORD-001 ORD-002 ORD-003 ORD-004 ORD-005 ORD-006 ORD-007 ORD-008 ORD-009 ORD-010 ORD-011 ORD-012 ORD-014 ORD-015
FUL-001 FUL-002 FUL-003 FUL-004 FUL-005 FUL-006 FUL-007 FUL-009 FUL-011 FUL-012
CUS-001 CUS-002 CUS-003 CUS-004 CUS-005 CUS-006 CUS-007 CUS-008 CUS-011 CUS-012 CUS-016
PRD-001 PRD-002 PRD-003 PRD-004 PRD-005 PRD-006 PRD-007 PRD-008 PRD-009 PRD-010
PRI-002 PRI-003 PRI-004 PRI-008 PRI-011
MAR-001 MAR-002 MAR-003 MAR-004 MAR-005 MAR-007 MAR-013 MAR-014 MAR-015 MAR-016
TEA-001 TEA-002 TEA-003 TEA-004 TEA-005 TEA-007 TEA-008 TEA-010 TEA-011 TEA-012
RET-001 RET-002 RET-003 RET-004 RET-005 RET-007 RET-008 RET-009 RET-010 RET-012
AR-001 AR-002 AR-003 AR-004 AR-005 AR-006 AR-007 AR-008 AR-009 AR-010 AR-011 AR-012 AR-013 AR-014
INV-001""".split())
DEMO_ONLY={"MAR-009":"Restated COGS exists only in the demo dataset; D365 cost-adjustment source not mapped yet.","PRI-001":"List price comes from the demo product master; D365 trade agreements not synced."}
BLOCKED={"REV-016":None,"ORD-016":"Order change/audit log (SalesLine history) not available in synced entities.","PRI-005":"Price override flag not in invoice line entity.",
"PRI-006":"Price floor not configured in source.","PRI-007":"Needs trade agreement prices.","PRI-009":"Promotion/campaign data not synced.","PRI-010":"Trade agreements not synced.","PRI-012":"Rebate management not synced.",
"MAR-010":"Cost-to-serve allocation not approved / no logistics cost source.","MAR-011":"No logistics cost source.","AR-015":"No dispute flag in customer transactions.","AR-016":"Write-off journals not mapped.",
"RET-006":"Return order dates (ReturnOrderHeadersV2) not projected into SI yet."}
for k in ["DSP-%03d"%i for i in range(1,9)]: BLOCKED[k]="ONE365 Dispatch / Van Sales integration not enabled for this tenant."
BLOCKED.pop("REV-016")
NEEDS={"MAR":"cogs","FUL":"slips","PRD-005":"cogs","TEA-008":"cogs","RET-007":"cogs","PRI-011":"cogs","FUL-003":"slips","ORD-015":"holds","AR-014":"settlements","AR-009":"settlements"}
AR={
"REV-001":"إجمالي المبيعات (بدون ضريبة)","REV-002":"إجمالي الخصومات","REV-003":"المرتجعات والإشعارات الدائنة","REV-004":"صافي المبيعات المفوترة","REV-005":"النمو السنوي %","REV-006":"النمو الشهري %","REV-007":"النمو الربعي %","REV-008":"المبيعات منذ بداية السنة","REV-009":"المبيعات منذ بداية الشهر","REV-010":"المبيعات منذ بداية الربع","REV-011":"مبيعات آخر 12 شهر","REV-012":"معدل النمو السنوي المركب","REV-013":"صافي المبيعات لكل يوم عمل","REV-014":"المبيعات المتوقعة بالمعدل الحالي","REV-015":"حصة المزيج %",
"TAR-001":"المستهدف المعتمد","TAR-002":"نسبة تحقيق المستهدف","TAR-003":"فجوة المستهدف","TAR-004":"فجوة المستهدف %","TAR-005":"تحقيق الوتيرة","TAR-006":"المتبقي للمستهدف","TAR-007":"المبيعات اليومية المطلوبة","TAR-008":"توقع صافي المبيعات","TAR-011":"النمو المتوقع لنهاية السنة","TAR-012":"تغطية المحجوز",
"ORD-001":"عدد أوامر البيع","ORD-002":"قيمة الأوامر الواردة","ORD-003":"الأوامر المؤكدة","ORD-004":"قيمة الأوامر المؤكدة","ORD-005":"قيمة الأوامر المفتوحة","ORD-006":"كمية الأوامر المفتوحة","ORD-007":"متوسط عمر الأوامر المفتوحة","ORD-008":"الأوامر المتأخرة","ORD-009":"قيمة الأوامر الملغاة","ORD-010":"نسبة الإلغاء","ORD-011":"سطور لكل أمر","ORD-012":"متوسط قيمة الأمر","ORD-014":"سطور الأوامر المفتوحة","ORD-015":"الأوامر الموقوفة",
"FUL-001":"الوحدات المسلّمة","FUL-002":"قيمة التسليمات","FUL-003":"مسلّم غير مفوتر","FUL-004":"التسليم في الموعد وكاملاً %","FUL-005":"التسليم في الموعد %","FUL-006":"التسليم الكامل %","FUL-007":"نسبة التسليم الجزئي","FUL-009":"متوسط مدة التنفيذ","FUL-011":"التسليمات المتأخرة","FUL-012":"تسليمات لكل أمر",
"CUS-001":"العملاء النشطون","CUS-002":"العملاء الجدد","CUS-003":"العملاء العائدون","CUS-004":"العملاء المُعاد تنشيطهم","CUS-005":"العملاء الخاملون","CUS-006":"نسبة الشراء المتكرر","CUS-007":"معدل تكرار الشراء","CUS-008":"متوسط الإيراد لكل عميل","CUS-011":"حصة أكبر 10 عملاء","CUS-012":"مؤشر تركز العملاء HHI","CUS-016":"أيام منذ آخر شراء",
"PRD-001":"الوحدات المباعة","PRD-002":"متوسط سعر البيع","PRD-003":"حصة الصنف من الإيراد","PRD-004":"ترتيب الصنف بالإيراد","PRD-005":"ترتيب الصنف بالربح","PRD-006":"سرعة دوران الصنف","PRD-007":"نمو الفئة %","PRD-008":"نسبة مرتجع الصنف","PRD-009":"تحول مزيج الفئات","PRD-010":"تصنيف ABC",
"PRI-001":"سعر القائمة","PRI-002":"صافي متوسط سعر الفاتورة","PRI-003":"إجمالي الخصم","PRI-004":"نسبة الخصم المرجحة","PRI-008":"تغير متوسط السعر %","PRI-011":"سطور تحت حد الهامش",
"MAR-001":"تكلفة المبيعات المرحلة","MAR-002":"مجمل الربح","MAR-003":"هامش مجمل الربح %","MAR-004":"الهامش لكل وحدة","MAR-005":"قيمة السطور بهامش سالب","MAR-007":"التكلفة إلى المبيعات %","MAR-009":"أثر تسوية التكلفة","MAR-013":"الربح حسب العميل","MAR-014":"الربح حسب الصنف","MAR-015":"الربح حسب المندوب","MAR-016":"الربح حسب المنطقة",
"TEA-001":"صافي المبيعات لكل مندوب","TEA-002":"تحقيق مستهدف المندوب","TEA-003":"المبيعات حسب المنطقة","TEA-004":"المبيعات حسب القناة","TEA-005":"الإيراد لكل مندوب نشط","TEA-007":"نسبة خصم المندوب","TEA-008":"هامش المندوب %","TEA-010":"نمو المنطقة %","TEA-011":"مساهمة الفرع %","TEA-012":"تحول مزيج القنوات",
"RET-001":"قيمة المرتجعات","RET-002":"قيمة التسويات التجارية","RET-003":"نسبة المرتجع (قيمة)","RET-004":"نسبة المرتجع (وحدات)","RET-005":"عدد المرتجعات","RET-007":"أثر التكلفة للمرتجعات","RET-008":"عدد الإشعارات الدائنة","RET-009":"حصة أهم سبب مرتجع","RET-010":"مرتجع التلف %","RET-012":"أيام من البيع للمرتجع",
"AR-001":"رصيد الذمم المفتوح","AR-002":"الذمم المتأخرة","AR-003":"الذمم غير المستحقة","AR-004":"متأخر 0–30 يوم","AR-005":"متأخر 31–60 يوم","AR-006":"متأخر 61–90 يوم","AR-007":"متأخر أكثر من 90 يوم","AR-008":"المحصل نقداً","AR-009":"فعالية التحصيل %","AR-010":"أيام التحصيل DSO","AR-011":"استخدام حد الائتمان","AR-012":"التعرض الائتماني","AR-013":"عملاء فوق الحد","AR-014":"السداد في الموعد %","INV-001":"الطلب غير المنفذ",
}
LAYER={"REV":"INVOICED","TAR":"INVOICED","ORD":"ORDERED","FUL":"DELIVERED","CUS":"INVOICED","PRD":"INVOICED","PRI":"INVOICED","MAR":"INVOICED","TEA":"INVOICED","RET":"INVOICED","AR":"COLLECTED","INV":"ORDERED","AI":"DERIVED","DSP":"DISPATCH"}
DATE={"INVOICED":"invoice_date","ORDERED":"created / confirmed","DELIVERED":"delivery_date","COLLECTED":"settle_date / as-of","DERIVED":"as_of","DISPATCH":"route date"}
def agg(u):
    u=u.lower()
    if 'snapshot' in u: return 'snapshot as-of (semi-additive)'
    if 'percent' in u or 'ratio' in u or 'score' in u or 'index' in u or 'days' in u or '/' in u or 'rank' in u or 'points' in u or 'category' in u: return 'non-additive (recomputed)'
    if 'count' in u: return 'distinct count'
    return 'sum (additive)'
out=[]
for k in d['kpis']:
    i=k['id']
    st='IMPLEMENTED' if i in IMPL else 'DEMO ONLY' if i in DEMO_ONLY else 'BLOCKED BY SOURCE' if i in BLOCKED else 'NOT BUILT'
    note=DEMO_ONLY.get(i) or BLOCKED.get(i)
    needs=NEEDS.get(i) or NEEDS.get(k['domain'])
    lay=LAYER[k['domain']]
    if i.startswith('AR') and st!='NOT BUILT': pass
    out.append(dict(id=i,domain=k['domain'],domainName=k['domainName'],name=k['name'],ar=AR.get(i),definition=k['definition'],unit=k['unit'],
      aggregation=agg(k['unit']),layer=lay,dateRole=DATE[lay],status=st,note=note,needs=needs if st=='IMPLEMENTED' else None))
R={}
def m(ids,route):
    for x in ids.split(): R[x]=route
m("R01-01","/si");m("R01-03 R02-01","/si/daily");m("R01-09 R02-02 R02-04","/si/weekly");m("R01-04 R02-05 R02-09","/si/monthly");m("R01-05 R02-06","/si/quarterly")
m("R01-06 R02-07 R02-08","/si/yearly");m("R01-07 R09-09","/si/pvm");m("R01-08 R08-01 R08-02 R08-03 R08-05 R08-07","/si/products");m("R02-10","/si/targets")
m("R04-01 R04-02 R04-04 R04-05 R04-06 R04-08 R04-10 R05-06","/si/orders");m("R04-09 R05-01 R05-02 R05-03 R05-04 R05-07 R05-08 R06-04","/si/fulfilment")
m("R06-01 R06-02 R06-07 R06-09","/si/invoices");m("R06-05 R13-01 R13-02 R13-03 R13-04 R13-05 R13-07 R13-08 R13-09","/si/ar");m("R06-06 R08-10 R12-02 R12-03 R12-04 R12-05 R12-06 R12-07 R12-09","/si/returns")
m("R07-01","/si/customer");m("R07-02 R07-04 R07-05 R07-08 R07-09","/si/customers");m("R07-03 R08-06 R09-05 R10-01 R10-02 R10-03 R10-04 R10-05 R10-06 R10-07","/si/margin");m("R10-08","/si/margin")
m("R09-01 R09-04 R09-07 R09-08","/si/pricing");m("R11-01 R11-02 R11-03 R11-04 R11-06 R11-07 R11-09","/si/team");m("R05-09 R13-10 R16-07 R16-08","/si/recon");m("R16-06 R16-10","/si/health")
RB=set("R02-03 R04-07 R05-05 R05-10 R06-10 R08-09 R09-02 R09-03 R09-06 R09-10 R10-09 R12-01 R12-08".split())|{"R16-%02d"%i for i in range(1,6)}|{"R17-%02d"%i for i in range(1,11)}
RDEMO={"R10-08"}
reps=[]
for r in d['reports']:
    i=r['id']
    st='DEMO ONLY' if i in RDEMO else 'IMPLEMENTED' if i in R else 'BLOCKED BY SOURCE' if i in RB else 'NOT BUILT'
    reps.append(dict(r,route=R.get(i),status=st))
from collections import Counter
print(Counter(x['status'] for x in out),Counter(x['status'] for x in reps))
open('lib/si/catalog.ts','w').write(
"/* Generated from the master spec §7 (180 KPIs) and §8 (170 reports) by scripts/gen-si-catalog.py.\n   Status is honest: IMPLEMENTED = computed by lib/si/metrics.ts and validated on the demo dataset;\n   DEMO ONLY = works only on demo fields; BLOCKED BY SOURCE = the synced D365 data lacks the field; NOT BUILT = not done yet. */\n"
"export type Status = \"IMPLEMENTED\" | \"DEMO ONLY\" | \"BLOCKED BY SOURCE\" | \"NOT BUILT\";\n"
"export interface Kpi { id: string; domain: string; domainName: string; name: string; ar: string | null; definition: string; unit: string; aggregation: string; layer: string; dateRole: string; status: Status; note: string | null; needs: string | null }\n"
"export interface ReportDef { id: string; domain: number; domainName: string; name: string; question: string; grain: string; route: string | null; status: Status }\n"
"export const CATALOG: Kpi[] = "+json.dumps(out,ensure_ascii=False,indent=0)+";\n"
"export const REPORTS: ReportDef[] = "+json.dumps(reps,ensure_ascii=False,indent=0)+";\n"
"export const kpi = (id: string) => CATALOG.find((k) => k.id === id);\n")
