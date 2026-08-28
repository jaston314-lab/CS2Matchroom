import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { saveServerConfigAction, testRconConnectionAction } from "./actions";

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
            className="w-full rounded bg-neutral-900 border border-neutral-700 px-3 py-2"
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
            className="rounded bg-blue-600 hover:bg-blue-500 px-4 py-2 text-white font-medium"
          >
            Save &amp; apply
          </button>
          <button
            type="submit"
            formAction={testRconConnectionAction}
            className="rounded border border-neutral-700 px-4 py-2 hover:border-neutral-500"
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
        className="w-full rounded bg-neutral-900 border border-neutral-700 px-3 py-2"
      />
      {hint && <p className="text-xs text-neutral-500 mt-1">{hint}</p>}
    </div>
  );
}

function Banner({ tone, children }: { tone: "ok" | "warn" | "error"; children: React.ReactNode }) {
  const styles = {
    ok: "border-green-800 bg-green-950 text-green-200",
    warn: "border-yellow-800 bg-yellow-950 text-yellow-200",
    error: "border-red-800 bg-red-950 text-red-200",
  }[tone];
  return <p className={`rounded border px-3 py-2 text-sm ${styles}`}>{children}</p>;
}
