export interface Game {
  id: number;
  title: string;
  description: string;
  author?: string | null;
  /** Feed only: total likes, and whether the signed-in user is one of them. */
  likes?: number;
  liked?: boolean;
  /** Feed only: total comments. */
  comments?: number;
  /** Feed only: whether the signed-in user saved it. Saves are private, so there's no count. */
  saved?: boolean;
  /** Saved list only: the save's id, which is the list's paging cursor. */
  saveId?: number;
}

export interface Comment {
  id: number;
  /** The commenter's @handle when they posted. */
  author: string;
  body: string;
  createdAt: string;
  /** True for the commenter and for the game's creator. */
  canDelete: boolean;
}

// iOS Simulator reaches the host at localhost; Android emulator needs http://10.0.2.2:8787; a phone needs the LAN IP.
export const API_URL =
  process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:8787";
export const gameUrl = (id: number) => `${API_URL}/api/games/${id}/document`;

export async function api<T>(
  path: string,
  {
    token,
    body,
    method = body === undefined ? "GET" : "POST",
  }: { token?: string | null; body?: unknown; method?: string } = {}
): Promise<T> {
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
    throw new Error(data.error || "Could not connect. Please try again.");
  }
  return data;
}
