export const BOT_HEALTH_PORT_ENV = "BOT_HEALTH_PORT";

const CONTAINER_DEFAULT_HEALTH_PORT = 3100;
const MAX_PORT = 65535;

/**
 * Port of the health endpoint; 0 means off. An empty or invalid value counts as
 * unset: on by default in a container, off elsewhere.
 */
export function resolveHealthPort(rawValue: string | undefined, inContainer: boolean): number {
  const defaultPort = inContainer ? CONTAINER_DEFAULT_HEALTH_PORT : 0;
  const value = rawValue?.trim();
  if (!value || !/^\d+$/.test(value)) {
    return defaultPort;
  }

  const port = Number.parseInt(value, 10);
  return port <= MAX_PORT ? port : defaultPort;
}
