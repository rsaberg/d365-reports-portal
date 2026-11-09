import { redirect } from "next/navigation";
import { login, currentUser } from "@/lib/auth";
import { ensureAdmin, migrate, needsSetup } from "@/lib/bootstrap";

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
  const app = process.env.APP_NAME ?? "D365 Reports Portal";
  return (
    <main className="min-h-full grid place-items-center px-4 py-10">
      <div className="w-full max-w-[380px]">
        <div className="mb-6">
          <div className="label">Dynamics 365 Finance &amp; Operations</div>
          <h1 className="text-2xl font-semibold mt-1">{app}</h1>
        </div>
        {firstRun ? (
          <>
            <form action={createFirstAdmin} className="card p-5 grid gap-4">
              <div>
                <h2 className="font-semibold">Create the first administrator</h2>
                <p className="text-muted text-[13px] mt-1">This form shows only until an administrator exists.</p>
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
                <p className="text-bad text-[13px]">{SETUP_ERRORS[searchParams.setup]}</p>
              )}
              <button className="btn btn-primary justify-center">Create administrator</button>
            </form>
          </>
        ) : (
          <>
            <form action={signIn} className="card p-5 grid gap-4">
              <div className="grid gap-1.5">
                <label htmlFor="email" className="label">Email</label>
                <input id="email" name="email" type="email" required autoComplete="username" className="input" />
              </div>
              <div className="grid gap-1.5">
                <label htmlFor="password" className="label">Password</label>
                <input id="password" name="password" type="password" required autoComplete="current-password" className="input" />
              </div>
              {searchParams.error && <p className="text-bad text-[13px]">Email or password is incorrect.</p>}
              <button className="btn btn-primary justify-center">Sign in</button>
            </form>
            <p className="text-muted text-[12px] mt-4">Accounts are created by your portal administrator.</p>
          </>
        )}
      </div>
    </main>
  );
}
