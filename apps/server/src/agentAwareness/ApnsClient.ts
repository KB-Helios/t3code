import * as NodeCrypto from "node:crypto";
import * as NodeHttp2 from "node:http2";

export interface ApnsConfig {
  readonly teamId: string;
  readonly keyId: string;
  readonly privateKey: string;
  readonly topic: string;
  readonly environment: "development" | "production";
}

export interface ApnsRequest {
  readonly authority: string;
  readonly path: string;
  readonly headers: Record<string, string>;
  readonly payload: unknown;
}

export interface ApnsResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly body: string;
}

export type ApnsTransport = (request: ApnsRequest) => Promise<ApnsResponse>;

export interface AgentActivityContentState {
  readonly name: "AgentActivity";
  readonly props: string;
}

export interface ApnsDeliveryResult {
  readonly ok: boolean;
  readonly status: number;
  readonly reason?: string;
}

const PROVIDER_TOKEN_REUSE_SECONDS = 45 * 60;

function encodeBase64Url(value: string | Uint8Array): string {
  return Buffer.from(value).toString("base64url");
}

function makeProviderToken(config: ApnsConfig, issuedAt: number): string {
  const header = encodeBase64Url(JSON.stringify({ alg: "ES256", kid: config.keyId }));
  const payload = encodeBase64Url(JSON.stringify({ iss: config.teamId, iat: issuedAt }));
  const signingInput = `${header}.${payload}`;
  const signature = NodeCrypto.sign("sha256", Buffer.from(signingInput), {
    key: config.privateKey,
    dsaEncoding: "ieee-p1363",
  });
  return `${signingInput}.${encodeBase64Url(signature)}`;
}

function defaultTransport(request: ApnsRequest): Promise<ApnsResponse> {
  return new Promise((resolve, reject) => {
    const session = NodeHttp2.connect(request.authority);
    session.once("error", reject);
    const stream = session.request({
      [NodeHttp2.constants.HTTP2_HEADER_METHOD]: "POST",
      [NodeHttp2.constants.HTTP2_HEADER_PATH]: request.path,
      ...request.headers,
    });
    let status = 0;
    let responseHeaders: NodeHttp2.IncomingHttpHeaders = {};
    let body = "";
    stream.setEncoding("utf8");
    stream.on("response", (headers) => {
      status = Number(headers[NodeHttp2.constants.HTTP2_HEADER_STATUS] ?? 0);
      responseHeaders = headers;
    });
    stream.on("data", (chunk: string) => {
      body += chunk;
    });
    stream.once("error", (error) => {
      session.close();
      reject(error);
    });
    stream.once("end", () => {
      session.close();
      resolve({ status, headers: responseHeaders as Record<string, string>, body });
    });
    stream.end(JSON.stringify(request.payload));
  });
}

export function makeApnsClient(
  config: ApnsConfig,
  transport: ApnsTransport = defaultTransport,
  nowSeconds: () => number = () => Math.floor((performance.timeOrigin + performance.now()) / 1_000),
) {
  let providerToken: { readonly token: string; readonly issuedAt: number } | null = null;

  const send = async (
    token: string,
    headers: Record<string, string>,
    payload: unknown,
  ): Promise<ApnsDeliveryResult> => {
    const now = nowSeconds();
    if (!providerToken || now - providerToken.issuedAt >= PROVIDER_TOKEN_REUSE_SECONDS) {
      providerToken = { token: makeProviderToken(config, now), issuedAt: now };
    }
    const response = await transport({
      authority:
        config.environment === "production"
          ? "https://api.push.apple.com"
          : "https://api.sandbox.push.apple.com",
      path: `/3/device/${token}`,
      headers: {
        authorization: `bearer ${providerToken.token}`,
        ...headers,
      },
      payload,
    });
    const parsed = response.body.trim()
      ? (JSON.parse(response.body) as { readonly reason?: string })
      : null;
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      ...(parsed?.reason ? { reason: parsed.reason } : {}),
    };
  };

  return {
    sendNotification(input: {
      readonly token: string;
      readonly title: string;
      readonly body: string;
      readonly deepLink: string;
    }) {
      return send(
        input.token,
        {
          "apns-topic": config.topic,
          "apns-push-type": "alert",
          "apns-priority": "10",
        },
        {
          aps: {
            alert: { title: input.title, body: input.body },
            sound: "default",
          },
          deepLink: input.deepLink,
        },
      );
    },

    sendLiveActivity(input: {
      readonly token: string;
      readonly event: "start" | "update" | "end";
      readonly timestamp: number;
      readonly state: AgentActivityContentState;
    }) {
      return send(
        input.token,
        {
          "apns-topic": `${config.topic}.push-type.liveactivity`,
          "apns-push-type": "liveactivity",
          "apns-priority": input.event === "update" ? "5" : "10",
        },
        {
          aps: {
            timestamp: input.timestamp,
            event: input.event,
            ...(input.event === "start"
              ? { "attributes-type": "LiveActivityAttributes", attributes: {} }
              : {}),
            "content-state": input.state,
          },
        },
      );
    },
  };
}
