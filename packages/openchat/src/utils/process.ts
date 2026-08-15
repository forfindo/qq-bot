export const sanitizedProcessEnv = (overrides?: Record<string, string>) => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== void 0)
  );
  return overrides ? Object.assign(env, overrides) : env;
};
