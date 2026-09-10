export type Game = { id: number; title: string; description: string }
export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, options)
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Could not connect. Please try again.')
  return data
}
export const post = (body?: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) })
