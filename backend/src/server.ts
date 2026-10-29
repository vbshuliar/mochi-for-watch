import { buildApp } from "./app.ts";
import { readConfig } from "./config.ts";
import { attachRealtime } from "./realtime.ts";
try {
  const config = readConfig();
  const { app, pairing } = await buildApp(config);
  const closeRealtime = attachRealtime(app.server, config, undefined, (token) =>
    pairing.authorized(token),
  );
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.once(signal, () => {
      closeRealtime();
      void app.close().then(() => process.exit(0));
    });
  await app.listen({ host: config.HOST, port: config.PORT });
  console.log(
    JSON.stringify({
      event: "ready",
      mode: config.APP_MODE,
      host: config.HOST,
      port: config.PORT,
    }),
  );
} catch {
  console.error(
    "Backend could not start. Check configuration, database permissions and port availability. Run npm run doctor.",
  );
  process.exitCode = 1;
}
