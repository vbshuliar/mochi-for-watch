import { buildApp } from "./app.ts";
import { readConfig } from "./config.ts";
try {
  const config = readConfig();
  const { app } = await buildApp(config);
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.once(signal, () => {
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
