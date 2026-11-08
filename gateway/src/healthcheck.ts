const port = Number(process.env.GATEWAY_PORT || 4096);

try {
  const response = await fetch(`http://127.0.0.1:${port}/health/live`, {
    signal: AbortSignal.timeout(2_000),
  });
  if (!response.ok) {
    process.exitCode = 1;
  }
} catch {
  process.exitCode = 1;
}
