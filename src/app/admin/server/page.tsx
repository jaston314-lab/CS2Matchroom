import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { saveServerConfigAction, testRconConnectionAction, regenerateInviteCodeAction } from "./actions";

export default async function AdminServerPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireRole(["ADMIN"]);
  const params = await searchParams;
  const config = await db.serverConfig.findUnique({ where: { id: "singleton" } });
  const hasPassword = !!config?.rconPasswordEncrypted;

  return (
    <div className="max-w-lg space-y-6">
      <h1 className="text-2xl font-semibold">Server config</h1>

      {params.saved && !params.applyError && (
        <Banner tone="ok">Saved and applied to the server.</Banner>
      )}
      {params.saved && params.applyError && (
        <Banner tone="warn">
          Saved, but couldn&apos;t apply the webhook/server-id convars over RCON: {params.applyError}
        </Banner>
      )}
      {params.testOk === "1" && <Banner tone="ok">Connected — server hostname: {params.testHostname}</Banner>}
      {params.testOk === "0" && <Banner tone="error">Connection failed: {params.testError}</Banner>}
      {params.inviteRegenerated && <Banner tone="ok">Invite code regenerated.</Banner>}

      <section className="rounded-xl border border-blue-800/60 bg-blue-950/10 p-4 space-y-2">
        <h2 className="text-sm font-medium text-neutral-300">Invite code</h2>
        <p className="text-xs text-neutral-500">
          Required to create a brand-new account — existing members log back in freely. Hosts can
          see this on the dashboard; regenerating invalidates it for anyone who hasn&apos;t signed
          up yet.
        </p>
        <div className="flex items-center gap-3">
          <span className="font-mono tracking-widest text-lg">
            {config?.inviteCode || <span className="text-yellow-500 text-sm">Not set</span>}
          </span>
          <form action={regenerateInviteCodeAction}>
            <button className="rounded-lg border border-neutral-700 px-3 py-1.5 text-sm hover:border-blue-500 transition-colors">
              {config?.inviteCode ? "Regenerate" : "Generate"}
            </button>
          </form>
        </div>
      </section>

      <form action={saveServerConfigAction} className="space-y-4">
        <Field label="RCON host" name="rconHost" defaultValue={config?.rconHost ?? "192.168.100.80"} />
        <Field label="RCON port" name="rconPort" type="number" defaultValue={String(config?.rconPort ?? 25568)} />
        <div>
          <label className="block text-sm text-neutral-300 mb-1" htmlFor="rconPassword">
            RCON password {hasPassword && <span className="text-neutral-500">(currently set — leave blank to keep it)</span>}
          </label>
          <input
            id="rconPassword"
            name="rconPassword"
            type="password"
            autoComplete="off"
            className="w-full rounded-lg bg-neutral-900 border border-neutral-700 px-3 py-2 focus:border-blue-500 focus:outline-none"
          />
        </div>
        <Field
          label="Webhook shared secret"
          name="webhookSharedSecret"
          defaultValue={config?.webhookSharedSecret ?? ""}
          hint="Sent as X-MatchZy-Secret on both the config-load RCON call and expected on incoming webhook posts."
        />
        <Field
          label="App public URL"
          name="appPublicUrl"
          defaultValue={config?.appPublicUrl ?? process.env.APP_PUBLIC_URL ?? ""}
          hint="Must be reachable from the CS2 server's network — used to build the match config URL and webhook URL."
        />

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            className="rounded-lg bg-blue-600 hover:bg-blue-500 px-4 py-2 text-white font-medium transition-colors"
          >
            Save &amp; apply
          </button>
          <button
            type="submit"
            formAction={testRconConnectionAction}
            className="rounded-lg border border-neutral-700 px-4 py-2 hover:border-blue-500 transition-colors"
          >
            Test RCON connection
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({
  label,
  name,
  defaultValue,
  type = "text",
  hint,
}: {
  label: string;
  name: string;
  defaultValue: string;
  type?: string;
  hint?: string;
}) {
  return (
    <div>
      <label className="block text-sm text-neutral-300 mb-1" htmlFor={name}>
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        defaultValue={defaultValue}
        className="w-full rounded-lg bg-neutral-900 border border-neutral-700 px-3 py-2 focus:border-blue-500 focus:outline-none"
      />
      {hint && <p className="text-xs text-neutral-500 mt-1">{hint}</p>}
    </div>
  );
}

function Banner({ tone, children }: { tone: "ok" | "warn" | "error"; children: React.ReactNode }) {
  const styles = {
    ok: "border-emerald-800 bg-emerald-950/60 text-emerald-200",
    warn: "border-yellow-800 bg-yellow-950/60 text-yellow-200",
    error: "border-red-800 bg-red-950/60 text-red-200",
  }[tone];
  return <p className={`rounded-lg border px-3 py-2 text-sm ${styles}`}>{children}</p>;
}
