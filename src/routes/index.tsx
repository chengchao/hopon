import { createFileRoute, Link } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type Game } from '../lib'
import { snapTarget } from '../feed-motion.js'
import { feedPage } from '../feed-games.js'
export const Route = createFileRoute('/')({ component: Discover })
export function gameUrl(id: number) { return id < 0 ? `/demos/${id === -1 ? 'orbit' : 'garden'}.html` : `/api/games/${id}/document` }
function Discover() {
  const [games, setGames] = useState<Game[]>([])
  const [active, setActive] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [next, setNext] = useState<number | null>(null)
  const feed = useRef<HTMLDivElement>(null)
  const busy = useRef(false)
  const gestureStart = useRef<{ y: number; origin: number } | null>(null)
  const load = useCallback(async (before?: number) => {
    if (busy.current) return
    busy.current = true; setLoading(true); setError('')
    try {
      const data = await api<{ games: Game[]; next: number | null }>(`/api/games${before ? `?before=${before}` : ''}`)
      const page = feedPage(data)
      setGames(old => before ? [...old, ...page] : page)
      setNext(data.next)
    } catch (e) { setError((e as Error).message) }
    finally { busy.current = false; setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])
  useEffect(() => {
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) { setActive(Number((entry.target as HTMLElement).dataset.index)) }
    }, { root: feed.current, threshold: 0.6 })
    feed.current?.querySelectorAll('article').forEach(card => observer.observe(card))
    return () => observer.disconnect()
  }, [games])
  useEffect(() => { if (next && active >= games.length - 2 && !error) void load(next) }, [active, next, games.length, load, error])
  const move = useCallback((direction: number) => {
    feed.current?.querySelectorAll('article')[active + direction]?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' })
  }, [active])
  const settle = useCallback((origin: number) => {
    const element = feed.current
    if (!element) return
    element.scrollTo({ top: snapTarget(origin, element.scrollTop, element.clientHeight, games.length), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })
  }, [games.length])
  useEffect(() => {
    const element = feed.current
    let timer: ReturnType<typeof setTimeout> | undefined
    let origin: number | null = null
    const browse = (event: WheelEvent) => {
      event.preventDefault()
      if (!element || !(event.target instanceof Element) || !event.target.closest('.game-info') || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return
      origin ??= Math.round(element.scrollTop / element.clientHeight) * element.clientHeight
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1)
      element.scrollTop = Math.max(origin - element.clientHeight, Math.min(origin + element.clientHeight, element.scrollTop + delta))
      clearTimeout(timer)
      timer = setTimeout(() => { if (origin !== null) settle(origin); origin = null }, 160)
    }
    element?.addEventListener('wheel', browse, { passive: false })
    return () => { element?.removeEventListener('wheel', browse); clearTimeout(timer) }
  }, [settle])
  return <main className="discover">
    <div className="feed" ref={feed} tabIndex={0} aria-label="Game feed. Swipe on the game name and description to browse." onKeyDown={event => {
      if (event.target !== event.currentTarget) return
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); move(event.key === 'ArrowDown' ? 1 : -1) }
    }}>
      {games.map((game, index) => <article key={game.id} data-index={index} className="game-card" aria-label={game.title}>
        <div className="game-window">
          {Math.abs(index - active) <= 1 && <iframe key={game.id} src={gameUrl(game.id)} title={`Play: ${game.title}`} sandbox="allow-scripts" referrerPolicy="no-referrer" tabIndex={index === active ? 0 : -1} />}
        </div>
        <div className="game-info" aria-label="Swipe up or down here to change games"
          onPointerDown={event => {
            if (!feed.current || event.button !== 0) return
            feed.current.scrollTo({ top: feed.current.scrollTop, behavior: 'instant' })
            gestureStart.current = { y: event.clientY, origin: feed.current.scrollTop }
            event.currentTarget.setPointerCapture(event.pointerId)
          }}
          onPointerMove={event => {
            const start = gestureStart.current
            if (start && feed.current) feed.current.scrollTop = start.origin + start.y - event.clientY
          }}
          onPointerCancel={() => { if (gestureStart.current) settle(gestureStart.current.origin); gestureStart.current = null }}
          onPointerUp={() => {
            if (gestureStart.current) settle(gestureStart.current.origin)
            gestureStart.current = null
          }}><span className="tiny-label">{game.id < 0 ? 'HOPON ORIGINAL' : 'COMMUNITY CREATION'}</span><h2>{game.title}</h2><p>{game.description}</p><span className="swipe-hint">{index === games.length - 1 && !next ? 'Swipe down for previous games ↓' : 'Swipe here for the next game ↑'}</span></div>
      </article>)}
    </div>
    <header className="discover-header"><span>Discover</span><Link to="/create" aria-label="Create a game">✳ Create</Link></header>
    {error && <div className="feed-status error" role="alert">{error} <button onClick={() => void load(next ?? undefined)}>Try again</button></div>}
    {!games.length && !error && <div className="feed-status empty">{loading ? 'Finding something fun…' : 'No games loaded yet.'}</div>}
    {!!games.length && <div className="feed-arrows"><button aria-label="Previous game" disabled={active === 0} onClick={() => move(-1)}>↑</button><span aria-live="polite">{active + 1} / {games.length}</span><button aria-label="Next game" disabled={active >= games.length - 1} onClick={() => move(1)}>↓</button></div>}
  </main>
}
