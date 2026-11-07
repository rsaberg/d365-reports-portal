import { redirect } from "next/navigation";
import { login, currentUser } from "@/lib/auth";

async function signIn(formData: FormData) {
  "use server";
  const err = await login(String(formData.get("email") ?? ""), String(formData.get("password") ?? ""));
  if (err) redirect("/login?error=1");
  redirect("/");
}

export default async function LoginPage({ searchParams }: { searchParams: { error?: string } }) {
  if (await currentUser()) redirect("/");
  const app = process.env.APP_NAME ?? "D365 Reports Portal";
  return (
    <main className="min-h-full grid place-items-center px-4 py-10">
      <div className="w-full max-w-[380px]">
        <div className="mb-6">
          <div className="label">Dynamics 365 Finance &amp; Operations</div>
          <h1 className="text-2xl font-semibold mt-1">{app}</h1>
        </div>
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
      </div>
    </main>
  );
}
