import type { ApnsConfig } from "./ApnsClient.ts";

export type ApnsConfigurationState =
  | { readonly capability: "available"; readonly config: ApnsConfig }
  | { readonly capability: "unavailable"; readonly reason: "apns-not-configured" };

type Environment = Readonly<Record<string, string | undefined>>;
type ReadTextFile = (path: string) => Promise<string>;

export async function readApnsConfiguration(
  environment: Environment,
  readTextFile: ReadTextFile,
): Promise<ApnsConfigurationState> {
  const teamId = environment.T3CODE_APNS_TEAM_ID?.trim();
  const keyId = environment.T3CODE_APNS_KEY_ID?.trim();
  const privateKeyPath = environment.T3CODE_APNS_PRIVATE_KEY_PATH?.trim();
  const topic = environment.T3CODE_APNS_TOPIC?.trim();
  const apnsEnvironment = environment.T3CODE_APNS_ENVIRONMENT?.trim();
  if (
    !teamId ||
    !keyId ||
    !privateKeyPath ||
    !topic ||
    (apnsEnvironment !== "development" && apnsEnvironment !== "production")
  ) {
    return { capability: "unavailable", reason: "apns-not-configured" };
  }

  try {
    const privateKey = await readTextFile(privateKeyPath);
    if (!privateKey.trim()) {
      return { capability: "unavailable", reason: "apns-not-configured" };
    }
    return {
      capability: "available",
      config: { teamId, keyId, privateKey, topic, environment: apnsEnvironment },
    };
  } catch {
    return { capability: "unavailable", reason: "apns-not-configured" };
  }
}
