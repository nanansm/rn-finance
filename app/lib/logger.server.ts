export function log(
  level: 'info' | 'warn' | 'error' | 'debug',
  event: string,
  data?: Record<string, unknown>,
) {
  const fn =
    level === 'error'
      ? console.error
      : level === 'warn'
        ? console.warn
        : console.log;
  fn(
    JSON.stringify({
      level,
      event,
      ts: new Date().toISOString(),
      ...data,
    }),
  );
}
