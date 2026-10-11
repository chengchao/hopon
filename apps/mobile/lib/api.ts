// iOS Simulator reaches the host at localhost; Android emulator needs http://10.0.2.2:8787; a phone needs the LAN IP.
// A release build has no fallback: one missing the EAS env var would ship pointing at localhost.
const apiUrl =
  process.env.EXPO_PUBLIC_API_URL ??
  (__DEV__ ? "http://localhost:8787" : undefined);
if (!apiUrl) {
  throw new Error("Set EXPO_PUBLIC_API_URL in the EAS environment");
}
export const API_URL = apiUrl;
export const gameUrl = (id: number) => `${API_URL}/api/games/${id}/document`;

// `code` is set when the app acts on an error rather than just showing it.
export class ApiError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = "ApiError";
    this.code = code;
  }
}

// Screening refused the Handle: the person picks a new one on the handle screen, which says why.
export const HANDLE_REJECTED = "/handle?rejected=1";
export const handleRejected = (error: unknown) =>
  error instanceof ApiError && error.code === "handle_rejected";

export const api = async <T>(
  path: string,
  {
    token,
    body,
    method = body === undefined ? "GET" : "POST",
  }: { token?: string | null; body?: unknown; method?: string } = {}
): Promise<T> => {
  const response = await fetch(API_URL + path, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    method,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(
      data.error || "Could not connect. Please try again.",
      data.code
    );
  }
  return data;
};
