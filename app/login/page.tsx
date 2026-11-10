import { redirect } from "next/navigation";
import { login, currentUser } from "@/lib/auth";
import { ensureAdmin, migrate, needsSetup } from "@/lib/bootstrap";
import { One365Logo, GrowPathMark } from "@/components/Brand";

export const dynamic = "force-dynamic";

async function signIn(formData: FormData) {
  "use server";
  const err = await login(String(formData.get("email") ?? ""), String(formData.get("password") ?? ""));
  if (err) redirect("/login?error=1");
  redirect("/");
}

/** First run only: creates the first administrator, then signs them in. Refused once an admin exists. */
async function createFirstAdmin(formData: FormData) {
  "use server";
  if (!(await needsSetup())) redirect("/login");
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  if (!name || !email) redirect("/login?setup=missing");
  if (password.length < 10) redirect("/login?setup=short");
  if (password !== confirm) redirect("/login?setup=mismatch");
  await migrate();
  await ensureAdmin(email, name, password);
  await login(email, password);
  redirect("/");
}

const SETUP_ERRORS: Record<string, string> = {
  missing: "Enter a name and an email.",
  short: "Use a password of at least 10 characters.",
  mismatch: "The two passwords do not match.",
};

export default async function LoginPage({ searchParams }: { searchParams: { error?: string; setup?: string } }) {
  const firstRun = await needsSetup();
  if (!firstRun && (await currentUser())) redirect("/");
  return (
    <main className="stage grid place-items-center px-4 py-10">
      <div className="w-full max-w-[400px]">
        <div className="mb-7 grid gap-4">
          <One365Logo size={40} onDark />
          <div>
            <h1 className="text-[26px] font-semibold leading-tight">Reports that read your ERP live.</h1>
            <p className="text-[13.5px] mt-1.5" style={{ color: "#9FB0CF" }}>Sales, finance and operations from Dynamics 365 Finance &amp; Operations — one place, every company.</p>
          </div>
        </div>
        {firstRun ? (
          <>
            <form action={createFirstAdmin} className="glass p-6 grid gap-4">
              <div>
                <h2 className="font-semibold">Create the first administrator</h2>
                <p className="text-[13px] mt-1" style={{ color: "#9FB0CF" }}>This form shows only until an administrator exists.</p>
              </div>
              <div className="grid gap-1.5">
                <label htmlFor="name" className="label">Name</label>
                <input id="name" name="name" required autoComplete="name" className="input" />
              </div>
              <div className="grid gap-1.5">
                <label htmlFor="email" className="label">Email</label>
                <input id="email" name="email" type="email" required autoComplete="username" className="input" />
              </div>
              <div className="grid gap-1.5">
                <label htmlFor="password" className="label">Password</label>
                <input id="password" name="password" type="password" required minLength={10} autoComplete="new-password" className="input" />
              </div>
              <div className="grid gap-1.5">
                <label htmlFor="confirm" className="label">Confirm password</label>
                <input id="confirm" name="confirm" type="password" required minLength={10} autoComplete="new-password" className="input" />
              </div>
              {searchParams.setup && SETUP_ERRORS[searchParams.setup] && (
                <p className="text-[13px] text-[#FF7A7A]">{SETUP_ERRORS[searchParams.setup]}</p>
              )}
              <button className="btn btn-primary justify-center">Create administrator</button>
            </form>
          </>
        ) : (
          <>
            <form action={signIn} className="glass p-6 grid gap-4">
              <div className="grid gap-1.5">
                <label htmlFor="email" className="label">Email</label>
                <input id="email" name="email" type="email" required autoComplete="username" className="input" />
              </div>
              <div className="grid gap-1.5">
                <label htmlFor="password" className="label">Password</label>
                <input id="password" name="password" type="password" required autoComplete="current-password" className="input" />
              </div>
              {searchParams.error && <p className="text-[13px] text-[#FF7A7A]">Email or password is incorrect.</p>}
              <button className="btn btn-primary justify-center">Sign in</button>
            </form>
            <p className="text-[12px] mt-4" style={{ color: "#8E9AB6" }}>Accounts are created by your portal administrator.</p>
          </>
        )}
        <div className="mt-10 flex items-center justify-between">
          <GrowPathMark />
          <span className="text-[11px]" style={{ color: "#8E9AB6" }}>ONE365 · Grow Path</span>
        </div>
      </div>
    </main>
  );
}
