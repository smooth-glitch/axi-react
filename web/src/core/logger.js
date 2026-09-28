// Tiny structured logger: timestamp + level + scope + optional payload.
const fmt = (level, scope, msg, data) => {
  const line = `${new Date().toISOString()} [${level}] [${scope}] ${msg}`;
  return data === undefined ? [line] : [line, data];
};

export const createLogger = (scope) => ({
  debug: (msg, data) => console.debug(...fmt('debug', scope, msg, data)),
  info: (msg, data) => console.info(...fmt('info', scope, msg, data)),
  warn: (msg, data) => console.warn(...fmt('warn', scope, msg, data)),
  error: (msg, data) => console.error(...fmt('error', scope, msg, data)),
});
