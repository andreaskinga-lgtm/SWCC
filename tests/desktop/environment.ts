export function desktopEnvironment(overrides: Record<string, string> = {}): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const [name, value] of Object.entries({ ...process.env, ...overrides })) {
    // Windows enables Node mode even when this variable is an empty string.
    if (name !== 'ELECTRON_RUN_AS_NODE' && value !== undefined) environment[name] = value;
  }
  return environment;
}
