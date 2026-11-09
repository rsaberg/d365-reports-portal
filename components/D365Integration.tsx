"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Fragment, useEffect, useMemo, useState } from "react";

/* Administration › D365 integration — same page as ONE365 / Elsewedy WMS: connection, Postman collection,
   function → request / data entity mapping with a first-5 test, run a request, recent calls. */

type Lang = "ar" | "en";
type LT = (a: string, e: string) => string;

async function api(url: string, body?: any) {
  const r = await fetch(url, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {});
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "HTTP " + r.status);
  return j;
}
const fmt = (d?: string | null) => (d ? String(d).slice(0, 16).replace("T", " ") : "—");
function Msg({ ok, err }: { ok?: string; err?: string }) {
  return <>{ok && <div className="msg-ok">{ok}</div>}{err && <div className="msg-err">{err}</div>}</>;
}

const SAMPLE = (company: string) => ({
  info: { name: "D365 Reports Portal · D365 F&O OData", schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json" },
  variable: [{ key: "resource", value: "https://your-env.operations.dynamics.com" }, { key: "company", value: company || "USMF" }],
  item: [
    { name: "Master data", item: [
      { name: "Legal entities", request: { method: "GET", url: "{{resource}}/data/LegalEntities?$select=LegalEntityId,Name,AccountingCurrency" } },
      { name: "Customers", request: { method: "GET", url: "{{resource}}/data/CustomersV3?cross-company=true&$filter=dataAreaId eq '{{company}}'&$select=CustomerAccount,OrganizationName,CustomerGroupId,CreditLimit&$top=500" } },
      { name: "Employees", request: { method: "GET", url: "{{resource}}/data/EmployeesV2?$select=PersonnelNumber,Name&$top=500" } },
    ] },
    { name: "Sales", item: [
      { name: "Sales invoice headers", request: { method: "GET", url: "{{resource}}/data/SalesInvoiceHeadersV4?cross-company=true&$filter=dataAreaId eq '{{company}}'&$orderby=InvoiceDate desc&$top=200" } },
      { name: "Sales invoice lines", request: { method: "GET", url: "{{resource}}/data/SalesInvoiceV4Lines?cross-company=true&$filter=dataAreaId eq '{{company}}'&$top=1000" } },
      { name: "Sales order headers", request: { method: "GET", url: "{{resource}}/data/SalesOrderHeadersV4?cross-company=true&$filter=dataAreaId eq '{{company}}'&$top=200" } },
      { name: "Sales order lines", request: { method: "GET", url: "{{resource}}/data/SalesOrderLinesV3?cross-company=true&$filter=dataAreaId eq '{{company}}'&$top=1000" } },
      { name: "Sales quotation headers", request: { method: "GET", url: "{{resource}}/data/SalesQuotationHeadersV2?cross-company=true&$filter=dataAreaId eq '{{company}}'&$top=200" } },
      { name: "Return order headers", request: { method: "GET", url: "{{resource}}/data/ReturnOrderHeadersV2?cross-company=true&$filter=dataAreaId eq '{{company}}'&$top=200" } },
    ] },
    { name: "Receivables & inventory", item: [
      { name: "Customer transactions (open)", request: { method: "GET", url: "{{resource}}/data/CustTransactions?cross-company=true&$filter=dataAreaId eq '{{company}}'&$top=1000" } },
      { name: "Inventory on-hand by site", request: { method: "GET", url: "{{resource}}/data/InventorySitesOnHandV2?cross-company=true&$filter=dataAreaId eq '{{company}}'&$top=1000" } },
    ] },
  ],
});

export default function D365Integration() {
  const [lang, setLang] = useState<Lang>("ar");
  useEffect(() => { try { const v = localStorage.getItem("portal-d365-lang"); if (v === "en" || v === "ar") setLang(v); } catch { /* ignore */ } }, []);
  const switchLang = (l: Lang) => { setLang(l); try { localStorage.setItem("portal-d365-lang", l); } catch { /* ignore */ } };
  const L: LT = (a, e) => (lang === "en" ? e : a);
  return (
    <div className="d365" dir={lang === "ar" ? "rtl" : "ltr"} lang={lang}>
      <div className="langs" role="group" aria-label="Language">
        <button className={lang === "ar" ? "on" : ""} onClick={() => switchLang("ar")}>عربي</button>
        <button className={lang === "en" ? "on" : ""} onClick={() => switchLang("en")}>English</button>
      </div>
      <D365 L={L} lang={lang} />
    </div>
  );
}

function D365({ L, lang }: { L: LT; lang: Lang }) {
  const [v, setV] = useState<any>(null), [c, setC] = useState<any>({ envUrl: "", tenantId: "", clientId: "", secret: "", company: "", authority: "https://login.microsoftonline.com", timeoutSec: 30 });
  const [map, setMap] = useState<Record<string, string>>({}), [ok, setOk] = useState(""), [err, setErr] = useState(""), [busy, setBusy] = useState(""), [test, setTest] = useState<any>(null);
  const [tests, setTests] = useState<Record<string, any>>({});
  async function testFn(fn: string) {
    setTests((t) => ({ ...t, [fn]: { loading: true } }));
    try { const j = await api("/api/admin/d365", { action: "testFn", fn, requestId: map[fn] }); setTests((t) => ({ ...t, [fn]: j })); }
    catch (e: any) { setTests((t) => ({ ...t, [fn]: { error: e.message } })); }
  }
  async function testAll() { for (const f of (v?.functions || [])) if (f.method === "GET" && map[f.id] && map[f.id] !== "e:") await testFn(f.id); }
  const [run, setRun] = useState<any>({ id: "", vars: "{\n}" }), [res, setRes] = useState<any>(null), [rq, setRq] = useState<any>(null), [filter, setFilter] = useState("");
  const apply = (j: any) => { setV(j); setMap(j.map || {}); if (j.connection) setC((x: any) => ({ ...x, ...j.connection, secret: "" })); };
  useEffect(() => { api("/api/admin/d365").then(apply).catch((e) => setErr(e.message)); }, []);
  async function act(body: any, msg: string, key = "x") { setBusy(key); setOk(""); setErr(""); try { const j = await api("/api/admin/d365", body); apply(j); if (j.test) setTest(j.test); setOk(msg); return j; } catch (e: any) { setErr(e.message); } finally { setBusy(""); } }
  async function upload(files: FileList | null, overwrite = false) {
    if (!files?.length) return;
    let coll: any = null, env: any = null;
    for (const f of Array.from(files)) {
      const t = await f.text(); let j: any; try { j = JSON.parse(t); } catch { setErr(L("الملف مش JSON: ", "Not a JSON file: ") + f.name); return; }
      if (j.item || j.collection) coll = j; else if (j.values) env = j;
    }
    if (!coll) { setErr(L("اختار ملف Postman Collection (v2.1)", "Choose a Postman collection file (v2.1)")); return; }
    const FN: Record<string, string> = { envUrl: L("رابط البيئة", "Environment URL"), tenantId: "Tenant ID", clientId: "Client ID", secret: "Client secret", company: L("الشركة", "Company") };
    const j = await act({ action: "upload", collection: coll, environment: env, overwrite }, "", "up");
    if (j?.detected) {
      const d = j.detected;
      setOk(L("الـ Collection اترفعت والـ requests اتربطت. ", "Collection uploaded and requests mapped. ") + (d.filled.length ? L("بيانات الاتصال اتاخدت من الملف: ", "Connection taken from the file: ") + d.filled.map((k: string) => FN[k] + " (" + d.source[k] + ")").join("، ") + ". " : L("مفيش بيانات اتصال جديدة في الملف. ", "No new connection details in the file. ")) + (d.missing.length ? L("ناقص: ", "Still missing: ") + d.missing.map((k: string) => FN[k]).join("، ") + L(" — كمّله واضغط حفظ.", " — complete it and press Save.") : L("اضغط «اختبار الاتصال».", "Press “Test connection”.")));
    }
  }
  async function doRun() {
    setRes(null); setErr(""); let vars: any = {};
    try { vars = run.vars.trim() ? JSON.parse(run.vars) : {}; } catch { setErr(L("المتغيرات لازم تكون JSON", "Variables must be JSON")); return; }
    setBusy("run"); try { const j = await api("/api/admin/d365", { action: "run", requestId: run.id, vars }); setRes(j.result); api("/api/admin/d365").then(apply); } catch (e: any) { setErr(e.message); } setBusy("");
  }
  const sample = () => { const b = new Blob([JSON.stringify(SAMPLE(c.company), null, 2)], { type: "application/json" }); const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = "D365_Reports_Portal.postman_collection.json"; a.click(); };
  const reqs: any[] = useMemo(() => v?.collection?.requests || [], [v]);
  const shown = useMemo(() => reqs.filter((r) => !filter || (r.name + r.url + r.folder).toLowerCase().includes(filter.toLowerCase())), [reqs, filter]);
  const tst = test || v?.connection?.lastTest;
  const B = (x: any) => !x ? null : x.ok ? <span className="badge ok">✓ {x.msg}</span> : <span className="badge bad">✕ {x.msg}</span>;
  return (<>
    <h2>{L("تكامل Dynamics 365 Finance & Operations", "Dynamics 365 Finance & Operations integration")}</h2>
    <p className="lead">{L("اربط البورتال ببيئة D365 عن طريق App Registration في Entra ID (Client credentials). بعدها ارفع Postman Collection فيها الـ requests بتاعتكم، واربط كل وظيفة في البورتال بالـ request أو الـ Data entity المناسب. الـ Token والـ Secret بيتعملوا ويتحفظوا على السيرفر بس.", "Connect the portal to your D365 environment through an Entra ID app registration (client credentials). Then upload a Postman collection with your requests and map each portal function to the right request or data entity. Tokens and secrets stay on the server.")}</p>

    <div className="pane"><h3> 1 · {L("بيانات الاتصال", "Connection")} {v?.connection ? (v.connection.fromEnv ? <span className="badge info">{L("من متغيرات السيرفر", "From server variables")}</span> : <span className="badge ok">{L("متسجلة", "Saved")}</span>) : <span className="badge warn">{L("مش متضبطة", "Not set")}</span>}</h3>
      <div className="g2">
        <div><label htmlFor="d-env">{L("رابط البيئة", "Environment URL")}</label><input id="d-env" dir="ltr" value={c.envUrl} onChange={(e) => setC({ ...c, envUrl: e.target.value })} placeholder="https://contoso.operations.dynamics.com" /></div>
        <div><label htmlFor="d-ten">Tenant ID</label><input id="d-ten" dir="ltr" autoComplete="off" data-lpignore="true" value={c.tenantId} onChange={(e) => setC({ ...c, tenantId: e.target.value })} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" /></div>
        <div><label htmlFor="d-cli">Client (Application) ID</label><input id="d-cli" dir="ltr" value={c.clientId} onChange={(e) => setC({ ...c, clientId: e.target.value })} placeholder="xxxxxxxx-xxxx-…" /></div>
        <div><label htmlFor="d-sec">Client secret {v?.connection?.secret && <span className="mono mut">({v.connection.secret})</span>}</label><input id="d-sec" dir="ltr" type="password" autoComplete="new-password" data-lpignore="true" value={c.secret} onChange={(e) => setC({ ...c, secret: e.target.value })} placeholder={v?.connection ? L("سيبه فاضي عشان يفضل زي ما هو", "Leave empty to keep the current one") : ""} /></div>
        <div><label htmlFor="d-co">{L("الشركة (DataAreaId) — بتتطبق على كل الطلبات", "Company (DataAreaId) — used by every request")}</label><input id="d-co" dir="ltr" value={c.company} onChange={(e) => setC({ ...c, company: e.target.value.toUpperCase() })} placeholder="USMF" /></div>
        <div><label htmlFor="d-auth">Authority</label><select id="d-auth" value={c.authority} onChange={(e) => setC({ ...c, authority: e.target.value })}><option>https://login.microsoftonline.com</option><option>https://login.microsoftonline.us</option><option>https://login.chinacloudapi.cn</option></select></div>
      </div>
      <div className="btns"><label className="btn-file">📥 {busy === "up" ? "…" : L("خد البيانات من ملف Postman", "Take the details from a Postman file")}<input type="file" accept=".json,application/json" multiple style={{ display: "none" }} onChange={(e) => { upload(e.target.files, true); e.target.value = ""; }} /></label>
        <button disabled={!!busy} onClick={() => act({ action: "save", ...c }, L("اتحفظ — اضغط «اختبار الاتصال»", "Saved — press “Test connection”"), "save")}>{busy === "save" ? "…" : L("حفظ", "Save")}</button>
        <button className="sec" disabled={!!busy || !v?.connection} onClick={() => act({ action: "test" }, L("الاختبار خلص", "Test finished"), "test")}>{busy === "test" ? "…" : L("اختبار الاتصال", "Test connection")}</button>
        {v?.connection && !v.connection.fromEnv && <button className="dan" disabled={!!busy} onClick={() => confirm(L("فصل الاتصال ومسح البيانات؟", "Disconnect and delete the connection?")) && act({ action: "disconnect" }, L("اتفصل", "Disconnected"))}>{L("فصل", "Disconnect")}</button>}</div>
      {tst && <div className="row"><span className="small mut">{fmt(tst.at)}</span> Token {B(tst.token)} {tst.odata && <>OData {B(tst.odata)}</>} {tst.odata?.warn && <span className="badge warn">{tst.odata.warn}</span>}</div>}
      {tst?.odata?.entities?.length > 0 && <div className="small mut" style={{ marginTop: 6 }}>{L("الشركات: ", "Legal entities: ")}<span className="mono">{tst.odata.entities.join(" · ")}</span></div>}
      <details style={{ marginTop: 12 }}><summary className="small" style={{ cursor: "pointer", fontWeight: 700 }}>{L("إزاي أعمل App Registration؟", "How do I create the app registration?")}</summary>
        <ol className="small" style={{ lineHeight: 1.9, paddingInlineStart: 20, listStyle: "decimal" }}>
          <li>{L("Azure portal ← Microsoft Entra ID ← App registrations ← New registration.", "Azure portal → Microsoft Entra ID → App registrations → New registration.")}</li>
          <li>{L("Certificates & secrets ← New client secret (انسخ الـ Value).", "Certificates & secrets → New client secret (copy the Value).")}</li>
          <li>{L("في D365: System administration ← Setup ← Microsoft Entra applications ← New: الـ Client ID ومستخدم بصلاحيات قراءة للـ entities.", "In D365: System administration → Setup → Microsoft Entra applications → New: the Client ID and a user with read access to the entities.")}</li>
        </ol></details>
      <Msg ok={busy ? "" : ok} err={err} /></div>

    <div className="pane"><h3>2 · Postman Collection {v?.collection && <span className="badge info">{v.collection.name} · {reqs.length} {L("request", "requests")}</span>}</h3>
      <label className="drop" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); upload(e.dataTransfer.files); }}>
        <input type="file" accept=".json,application/json" multiple style={{ display: "none" }} onChange={(e) => { upload(e.target.files); e.target.value = ""; }} />
        {busy === "up" ? "…" : <>⬆ {L("اسحب ملف الـ Collection هنا أو دوس للاختيار — ممكن ترفع معاه ملف Environment", "Drop the collection file here or click to choose — you can add an environment file too")}<div className="small" style={{ marginTop: 4 }}>Postman Collection v2.1 (.json)</div></>}
      </label>
      <div className="btns"><button className="sec" onClick={sample}>{L("نزّل Collection نموذجية لـ D365", "Download a sample D365 collection")}</button>
        {v?.collection && <button className="dan" onClick={() => confirm(L("مسح الـ Collection والربط؟", "Remove the collection and mappings?")) && act({ action: "removeCollection" }, L("اتمسحت", "Removed"))}>{L("مسح الـ Collection", "Remove collection")}</button>}</div>
      {v?.collection && <p className="small mut" style={{ marginTop: 10 }}>{L("اترفعت ", "Uploaded ")}{fmt(v.collection.uploadedAt)} · {v.collection.uploadedBy}{v.collection.envName ? " · Environment: " + v.collection.envName : ""}. {L("المتغيرات المتاحة تلقائي: ", "Variables filled automatically: ")}<span className="mono">{(v.vars || []).slice(0, 14).map((x: string) => "{{" + x + "}}").join(" ")}</span>. {L("الـ Authorization بيتحط من البورتال؛ أي token أو secret في الملف مش بيتستخدم.", "Authorization is added by the portal; tokens or secrets in the file are ignored.")}</p>}
    </div>

    {v && <div className="pane"><h3> 3 · {L("ربط وظائف البورتال بالـ requests أو الـ Data entities", "Map portal functions to requests or data entities")}</h3>
      <p className="small mut" style={{ marginTop: -4, marginBottom: 10 }}>{L("المزامنة بتقرا الـ Data entity المربوطة بكل وظيفة. الربط بـ Postman request بيتستخدم في الاختبار والتشغيل.", "The sync reads the data entity mapped to each function. A Postman request mapping is used for tests and runs.")}</p>
      <datalist id="d365ents">{(v.entities || []).map((x: string) => <option key={x} value={x} />)}</datalist>
      <div className="btns" style={{ marginTop: 0, marginBottom: 10, alignItems: "center" }}><button className="sec" disabled={!!busy || !v?.connection} onClick={() => act({ action: "entities" }, L("اتحمّلت قائمة الـ Data entities", "Data entity list loaded"), "ent")}>{busy === "ent" ? "…" : "⟳ " + L("تحميل كل الـ Data entities من D365", "Load all data entities from D365")}</button>
        <span className="small mut">{v.entities?.length ? `${v.entities.length} entity · ${fmt(v.entitiesAt)}` : L("لسه متحمّلتش — محتاج اتصال شغال", "Not loaded yet — needs a working connection")}</span></div>
      <div className="tw"><table><thead><tr><th>{L("الوظيفة", "Function")}</th><th>Postman request / Data entity</th><th>{L("مثال", "Typical endpoint")}</th><th>{L("اختبار", "Test")}</th></tr></thead><tbody>
        {v.functions.map((f: any) => <Fragment key={f.id}><tr><td><b>{lang === "en" ? f.en : f.ar}</b><div className="small mut mono">{f.id} · {f.method}</div></td>
          <td>{(() => { const mv = map[f.id] || ""; const isE = mv.startsWith("e:"); const [en, eq] = isE ? mv.slice(2).split(/\?(.*)/s) : ["", ""]; const setE = (n: string, q?: string) => setMap({ ...map, [f.id]: "e:" + n.replace(/[^A-Za-z0-9_]/g, "") + (q ? "?" + q : "") });
            return <><select aria-label={f.en} value={isE ? "__e" : mv} onChange={(e) => setMap({ ...map, [f.id]: e.target.value === "__e" ? "e:" : e.target.value })} style={{ minWidth: 240 }}><option value="">— {L("مش مربوطة", "Not mapped")} —</option>
              <option value="__e">🗂 {L("Data entity من D365…", "D365 data entity…")}</option>
              {reqs.length > 0 && <optgroup label="Postman">{reqs.map((r) => <option key={r.id} value={r.id}>{r.method} · {r.folder ? r.folder + " / " : ""}{r.name}</option>)}</optgroup>}</select>
              {isE && <div className="row" style={{ marginTop: 6 }}><input aria-label="Data entity" dir="ltr" list="d365ents" value={en} onChange={(e) => setE(e.target.value, eq)} placeholder={v.entities?.length ? L("اكتب أو اختار entity…", "Type or pick an entity…") : "CustomersV3"} style={{ minWidth: 220, flex: 1 }} />
                <input aria-label="Query" dir="ltr" value={eq || ""} onChange={(e) => setE(en, e.target.value)} placeholder={f.method === "GET" ? L("فاضي = شركة الاتصال · أو كود شركة (USMF) · أو $select=…", "empty = connection company · or a company code (USMF) · or $select=…") : L("فاضي = POST للـ entity", "empty = POST to the entity")} style={{ minWidth: 220, flex: 1 }} /></div>}</>; })()}</td>
          <td className="small mut mono" style={{ maxWidth: 360, whiteSpace: "normal" }}>{f.hint}</td>
          <td><button className="sec sm" disabled={!map[f.id] || map[f.id] === "e:" || !v?.connection || tests[f.id]?.loading} onClick={() => testFn(f.id)}>{tests[f.id]?.loading ? "…" : f.method === "GET" ? "▶ " + L("أول ٥", "First 5") : "👁 " + L("معاينة", "Preview")}</button></td></tr>
          {tests[f.id] && !tests[f.id].loading && <tr><td colSpan={4} className="sub"><TestResult t={tests[f.id]} L={L} onClose={() => setTests((x) => { const n = { ...x }; delete n[f.id]; return n; })} /></td></tr>}</Fragment>)}
      </tbody></table></div>
      <div className="btns"><button onClick={() => act({ action: "map", map }, L("الربط اتحفظ", "Mapping saved"))}>{L("حفظ الربط", "Save mapping")}</button><button className="sec" disabled={!v?.connection} onClick={testAll}>▶ {L("اختبر كل وظائف القراءة (أول ٥ سجلات)", "Test all read functions (first 5 records)")}</button></div></div>}

    {(v?.collection || v?.connection) && <div className="pane"><h3> 4 · {L("تشغيل request أو Data entity", "Run a request or data entity")}</h3>
      <div className="g2"><div><label htmlFor="r-ent">Data entity</label><input id="r-ent" dir="ltr" list="d365ents" value={run.id.startsWith("e:") ? run.id.slice(2) : ""} onChange={(e) => { const n = e.target.value.replace(/[^A-Za-z0-9_?=&$'., -]/g, ""); setRun({ ...run, id: n ? "e:" + n : "" }); setRes(null); setRq(n ? { method: "GET", url: "{{resource}}/data/" + n.split("?")[0] + (n.includes("?") ? "?" + n.split("?")[1] : "?cross-company=true&$filter=dataAreaId eq '{{company}}'&$top=1000") } : null); }} placeholder={L("اختار entity عشان تشوف بياناتها (GET)", "Pick an entity to read it (GET)")} /></div>
        <div><label htmlFor="r-q">{L("بحث في Postman", "Search Postman")}</label><input id="r-q" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="SalesInvoice…" /></div>
        <div><label htmlFor="r-rq">Postman request</label><select id="r-rq" value={run.id.startsWith("e:") ? "" : run.id} onChange={(e) => { setRun({ ...run, id: e.target.value }); setRes(null); api("/api/admin/d365", { action: "request", requestId: e.target.value }).then((j) => setRq(j.request)).catch(() => setRq(null)); }}><option value="">—</option>{shown.map((r) => <option key={r.id} value={r.id}>{r.method} · {r.name}</option>)}</select></div></div>
      {rq && <div style={{ marginTop: 10 }}><div className="mono small" style={{ direction: "ltr", textAlign: "left", wordBreak: "break-all" }}><b>{rq.method}</b> {rq.url}</div>
        {rq.body && <pre className="resp" style={{ maxHeight: 160 }}>{rq.body}</pre>}</div>}
      <label htmlFor="r-vars">{L("متغيرات إضافية (JSON) — زي {\"CustomerAccount\":\"US-001\"}", "Extra variables (JSON) — e.g. {\"CustomerAccount\":\"US-001\"}")}</label>
      <textarea id="r-vars" value={run.vars} onChange={(e) => setRun({ ...run, vars: e.target.value })} />
      <div className="btns"><button disabled={!run.id || busy === "run" || !v?.connection} onClick={doRun}>{busy === "run" ? "…" : "▶ " + L("تشغيل", "Run")}</button>{!v?.connection && <span className="small mut">{L("احفظ بيانات الاتصال الأول", "Save the connection first")}</span>}</div>
      {res && <div style={{ marginTop: 12 }}><div className="row" style={{ marginTop: 0 }}><span className={"badge " + (res.ok ? "ok" : "bad")}>HTTP {res.status}</span><span className="badge">{res.ms} ms</span><span className="badge">{(res.size / 1024).toFixed(1)} KB</span>
        {res.data?.value && <span className="badge info">{res.data.value.length} {L("سجل", "records")}</span>}{res.missing?.length > 0 && <span className="badge warn">{L("متغيرات ناقصة: ", "Missing variables: ")}{res.missing.join(", ")}</span>}</div>
        <pre className="resp">{res.data ? JSON.stringify(res.data, null, 2).slice(0, 60000) : res.text}</pre></div>}
      <Msg err={busy ? "" : err} /></div>}

    {v?.calls?.length > 0 && <div className="pane"><h3>{L("آخر العمليات مع D365", "Recent D365 calls")}</h3><div className="tw"><table><thead><tr><th>{L("الوقت", "Time")}</th><th>{L("المستخدم", "User")}</th><th>{L("الوظيفة", "Function")}</th><th>Request</th><th>{L("النتيجة", "Result")}</th><th>ms</th><th>{L("مرجع", "Ref")}</th></tr></thead>
      <tbody>{v.calls.map((x: any, i: number) => <tr key={i}><td className="small">{fmt(x.at)}</td><td className="small mono">{x.user}</td><td className="small">{x.fn || "—"}</td><td className="small">{x.method} {x.req}</td><td>{x.ok ? <span className="badge ok">{x.status}</span> : <span className="badge bad" title={x.error}>{x.status || L("خطأ", "Error")}</span>}</td><td className="small">{x.ms ?? ""}</td><td className="small mono">{x.ref || ""}</td></tr>)}</tbody></table></div></div>}
  </>);
}

/* first-5 test result under a mapping row */
function TestResult({ t, L, onClose }: { t: any; L: LT; onClose: () => void }) {
  const cols = t.rows?.length ? [...new Set(t.rows.flatMap((r: any) => Object.keys(r)))].slice(0, 10) as string[] : [];
  const cell = (v: any) => v == null ? "" : typeof v === "object" ? JSON.stringify(v).slice(0, 60) : String(v).slice(0, 60);
  return (<div style={{ padding: "4px 2px" }}>
    <div className="row" style={{ marginTop: 0 }}>
      {t.error && <span className="badge bad">✕ {t.error}</span>}
      {t.preview && <><span className="badge warn">{L("معاينة بس — عمليات الإرسال مش بتتبعت في الاختبار", "Preview only — sending operations are not executed in a test")}</span><span className="mono small" dir="ltr"><b>{t.method}</b> {t.url}</span></>}
      {t.status != null && <><span className={"badge " + (t.okHttp ? "ok" : "bad")}>HTTP {t.status}</span><span className="badge">{t.ms} ms</span>
        {t.total != null && <span className="badge info">{L("الإجمالي: ", "Total: ")}{Number(t.total).toLocaleString()}</span>}<span className="badge">{(t.rows || []).length} {L("سجل معروض", "shown")}</span>
        {t.missing?.length > 0 && <span className="badge warn">{L("متغيرات ناقصة: ", "Missing variables: ")}{t.missing.join(", ")}</span>}</>}
      <button className="link small" onClick={onClose} style={{ marginInlineStart: "auto" }} aria-label="Close">✕</button>
    </div>
    {t.preview && t.body && <pre className="resp" style={{ maxHeight: 140, marginTop: 6 }}>{t.body}</pre>}
    {t.status != null && t.okHttp && !cols.length && <div className="small mut" style={{ marginTop: 6 }}>{L("الطلب نجح بس مفيش سجلات — راجع الشركة (DataAreaId) أو الفلتر.", "The call succeeded but returned no records — check the company (DataAreaId) or the filter.")}</div>}
    {t.status != null && !t.okHttp && t.error && <pre className="resp" style={{ maxHeight: 120, marginTop: 6 }}>{t.error}</pre>}
    {cols.length > 0 && <div className="tw" style={{ marginTop: 6 }}><table style={{ direction: "ltr" }}><thead><tr>{cols.map((c) => <th key={c} className="mono">{c}</th>)}</tr></thead>
      <tbody>{t.rows.map((r: any, i: number) => <tr key={i}>{cols.map((c) => <td key={c} className="mono small">{cell(r[c])}</td>)}</tr>)}</tbody></table></div>}
    {cols.length > 0 && <div className="small mut" style={{ marginTop: 4 }} dir="ltr">{t.url}</div>}
  </div>);
}
