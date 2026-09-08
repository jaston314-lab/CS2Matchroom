import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { CopyButton } from "@/components/CopyButton";
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

      <SetupGuide />

      {params.saved && !params.applyError && (
        <Banner tone="ok">Saved and applied to the server.</Banner>
      )}
      {params.saved && params.applyError && (
        <Banner tone="warn">
          Saved, but couldn&apos;t apply the webhook/server-id convars over RCON: {params.applyError}.
          Use the console commands below instead — same effect.
        </Banner>
      )}
      {params.testOk === "1" && <Banner tone="ok">Connected — server hostname: {params.testHostname}</Banner>}
      {params.testOk === "0" && <Banner tone="error">Connection failed: {params.testError}</Banner>}
      {params.inviteRegenerated && <Banner tone="ok">Invite code regenerated.</Banner>}

      <section className="rounded-xl border border-blue-800/60 bg-blue-950/10 p-4 space-y-2">
        <h2 className="text-sm font-medium text-ink">Invite code</h2>
        <p className="text-xs text-muted">
          Required to create a brand-new account — existing members log back in freely. Hosts can
          see this on the matchroom page; regenerating invalidates it for anyone who hasn&apos;t signed
          up yet.
        </p>
        <div className="flex items-center gap-3">
          <span className="font-mono tracking-widest text-lg">
            {config?.inviteCode || <span className="text-yellow-500 text-sm">Not set</span>}
          </span>
          <form action={regenerateInviteCodeAction}>
            <button className="rounded-lg border border-line px-3 py-1.5 text-sm hover:border-blue-500 transition-colors">
              {config?.inviteCode ? "Regenerate" : "Generate"}
            </button>
          </form>
        </div>
      </section>

      {/* autoComplete="off" on the form is mostly ignored by password
          managers once they spot a type="password" field anywhere inside
          — that's what actually triggers Bitwarden to treat the whole
          thing as a login form and offer to fill the nearest text field
          as a "username". autoComplete="new-password" (below) is the hint
          password managers are most likely to actually respect for
          suppressing that. */}
      <form action={saveServerConfigAction} className="space-y-4" autoComplete="off">
        <Field
          label="RCON host"
          name="rconHost"
          defaultValue={config?.rconHost ?? ""}
          hint="Needed for live matches (loading/ending a match automatically when a host presses Start) — not for the one-time setup below, that can be done entirely by pasting commands into Pelican."
        />
        <Field label="RCON port" name="rconPort" type="number" defaultValue={String(config?.rconPort ?? 27015)} />
        <div>
          <label className="block text-sm text-ink mb-1" htmlFor="rconPassword">
            RCON password {hasPassword && <span className="text-muted">(currently set — leave blank to keep it)</span>}
          </label>
          <input
            id="rconPassword"
            name="rconPassword"
            type="password"
            autoComplete="new-password"
            data-lpignore="true"
            data-1p-ignore="true"
            className="w-full rounded-lg bg-input border border-line px-3 py-2 focus:border-blue-500 focus:outline-none"
          />
        </div>
        <Field
          label="Webhook shared secret"
          name="webhookSharedSecret"
          defaultValue={config?.webhookSharedSecret ?? ""}
          hint="Any random string. The server includes it on every match event it sends back, so this app can tell it's really your server."
        />
        <Field
          label="App public URL"
          name="appPublicUrl"
          defaultValue={config?.appPublicUrl ?? ""}
          hint="The one place this ever needs to be set — used for Steam sign-in and the CS2 server's match config, webhook, and demo upload. Must be reachable by players' browsers and by the CS2 server."
        />
        <Field
          label="Game connect address"
          name="gameConnectAddress"
          defaultValue={config?.gameConnectAddress ?? ""}
          hint={`What players type as "connect <this>" in the CS2 console to join a live match — shown on the matchroom page once a match starts. Not necessarily the same as the RCON host above: this needs to be reachable by players' game clients (their public IP/domain if they're off your LAN), while RCON only needs to be reachable by this app. Usually host:port, e.g. 192.168.100.80:25568.`}
        />
        <Field
          label="Local app URL (optional)"
          name="localAppUrl"
          defaultValue={config?.localAppUrl ?? ""}
          hint="Only matters if the CS2 server and this app are on the same network (RCON already reaching a LAN IP is a good sign they are). Demo files are large — if this is set, they're uploaded straight over the LAN instead of round-tripping through the public URL, which can otherwise exceed MatchZy's 60s upload timeout on a slower home connection. e.g. http://192.168.1.185:3000. Leave blank to just use the public URL for everything."
        />

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            className="rounded-lg bg-accent-blue hover:bg-accent-blue-hover px-4 py-2 text-white font-medium transition-colors"
          >
            Save &amp; apply
          </button>
          <button
            type="submit"
            formAction={testRconConnectionAction}
            className="rounded-lg border border-line px-4 py-2 hover:border-blue-500 transition-colors"
          >
            Test RCON connection
          </button>
        </div>
      </form>

      <ConsoleCommands
        appPublicUrl={config?.appPublicUrl ?? ""}
        webhookSharedSecret={config?.webhookSharedSecret ?? ""}
        localAppUrl={config?.localAppUrl ?? ""}
      />
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
      <label className="block text-sm text-ink mb-1" htmlFor={name}>
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        defaultValue={defaultValue}
        autoComplete="off"
        data-lpignore="true"
        data-1p-ignore="true"
        className="w-full rounded-lg bg-input border border-line px-3 py-2 focus:border-blue-500 focus:outline-none"
      />
      {hint && <p className="text-xs text-muted mt-1">{hint}</p>}
    </div>
  );
}

/**
 * The exact commands src/lib/rcon.ts's applyServerConfig() sends over RCON
 * on save — offered here as copy-paste text too, since "Save & apply"
 * relying on this app reaching the server's RCON port isn't always
 * something you want to depend on. Pasting these into Pelican's own
 * console (which always works — it's not going over the network the way
 * this app's outbound RCON call does) has the exact same effect.
 */
function ConsoleCommands({
  appPublicUrl,
  webhookSharedSecret,
  localAppUrl,
}: {
  appPublicUrl: string;
  webhookSharedSecret: string;
  localAppUrl: string;
}) {
  if (!appPublicUrl || !webhookSharedSecret) {
    return (
      <section className="rounded-xl border border-line bg-panel p-4 space-y-1.5 text-sm">
        <h2 className="font-medium text-ink">Pelican console commands</h2>
        <p className="text-muted text-xs">
          Fill in and save &quot;Webhook shared secret&quot; and &quot;App public URL&quot; above first — the exact
          commands to paste into the server console will appear here once both are set.
        </p>
      </section>
    );
  }

  const webhookUrl = `${appPublicUrl.replace(/\/$/, "")}/api/matchzy/webhook`;
  // Demo uploads are large — route them over the LAN if we have an address
  // for it, same reasoning as applyServerConfig in src/lib/rcon.ts.
  const demoUploadBase = localAppUrl || appPublicUrl;
  const demoUploadUrl = `${demoUploadBase.replace(/\/$/, "")}/api/matchzy/demo`;
  const commands = [
    `matchzy_server_id "cs2-matchroom"`,
    `matchzy_remote_log_url "${webhookUrl}"`,
    `matchzy_remote_log_header_key "X-MatchZy-Secret"`,
    `matchzy_remote_log_header_value "${webhookSharedSecret}"`,
    `matchzy_demo_upload_url "${demoUploadUrl}"`,
    `matchzy_demo_upload_header_key "X-MatchZy-Secret"`,
    `matchzy_demo_upload_header_value "${webhookSharedSecret}"`,
    `matchzy_demo_recording_enabled "1"`,
    `tv_enable "1"`,
  ].join("\n");

  return (
    <section className="rounded-xl border border-blue-800/60 bg-blue-950/10 p-4 space-y-2">
      <h2 className="text-sm font-medium text-ink">Pelican console commands</h2>
      <p className="text-xs text-muted">
        One-time setup — paste these into the server&apos;s console in Pelican. Only needs re-running
        if the webhook secret or public URL above change (e.g. moving to a new domain/server).{" "}
        <span className="text-muted">
          &quot;Save &amp; apply&quot; above already tries to run these for you automatically over RCON — this
          is only here for when you&apos;d rather do it yourself, or RCON isn&apos;t reachable from wherever
          this app runs.
        </span>
      </p>
      <div className="rounded-lg bg-app border border-line p-3 space-y-2">
        <pre className="text-xs text-ink whitespace-pre-wrap break-all font-mono">{commands}</pre>
        <CopyButton text={commands} label="Copy commands" />
      </div>
    </section>
  );
}

/**
 * Reference doc for "how do I connect this app to a CS2 server" — written
 * so future-you (or a fresh install pointed at a different server) has
 * somewhere to look instead of re-deriving it from the code.
 */
function SetupGuide() {
  return (
    <details className="rounded-xl border border-line bg-panel p-4 text-sm">
      <summary className="cursor-pointer font-medium text-ink">
        Connecting this app to a CS2 server — setup guide
      </summary>
      <ol className="mt-3 space-y-4 list-decimal list-inside text-ink">
        <li>
          <span className="font-medium">On the CS2 server:</span>{" "}
          <span className="text-muted">
            the MatchZy Enhanced plugin must be installed, and RCON enabled (an{" "}
            <code className="text-ink">rcon_password</code> set on the server). Note the RCON
            host/port — usually the same host/port as the game server itself, but it can differ.
          </span>
        </li>
        <li>
          <span className="font-medium">Fill in everything below and save</span> —{" "}
          <span className="text-muted">
            RCON host/port/password, a webhook shared secret (any random string), and the &quot;App
            public URL&quot; this app is reachable at. That last one is the only address that matters
            anywhere in this app — it&apos;s used for both Steam sign-in and the CS2 server&apos;s match
            config/webhook, so there&apos;s nothing else to keep in sync.
          </span>
        </li>
        <li>
          <span className="font-medium">Use &quot;Test RCON connection&quot;</span>{" "}
          <span className="text-muted">to confirm the app can actually reach the server before relying on it.</span>
        </li>
        <li>
          <span className="font-medium">Press &quot;Save &amp; apply&quot;.</span>{" "}
          <span className="text-muted">
            This does two things: saves your settings, and tries to push the one-time MatchZy setup
            convars to the server over RCON automatically. If that works, you&apos;re done. If RCON isn&apos;t
            reachable from wherever this app runs (common with some game-host setups), you&apos;ll see a
            warning — in that case, copy the commands from the &quot;Pelican console commands&quot; box
            further down and paste them into the server&apos;s console in Pelican yourself. Same result
            either way.
          </span>
        </li>
        <li>
          <span className="font-medium">That&apos;s the entire one-time setup.</span>{" "}
          <span className="text-muted">
            RCON still needs to work for actual live matches (loading/ending a match when a host
            presses Start) — that happens automatically from this app each time, there&apos;s nothing to
            paste for that part. If you ever switch to a different server or domain, come back to
            this page, update the fields, and re-run (or re-paste) the console commands — nothing
            outside this page ever needs editing.
          </span>
        </li>
      </ol>
    </details>
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
