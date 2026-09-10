import { createRootRoute, HeadContent, Link, Outlet, Scripts } from '@tanstack/react-router'
import stylesheet from '../styles.css?url'
export const Route = createRootRoute({
  head: () => ({ meta: [{ charSet: 'utf-8' }, { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' }, { title: 'hopon — Think it. Play it.' }, { name: 'description', content: 'Create a game with a few words. Swipe to discover something new.' }], links: [{ rel: 'stylesheet', href: stylesheet }] }),
  component: Root,
  notFoundComponent: () => <main className="empty"><h1>Nothing to play here yet</h1><Link to="/">Back to Discover</Link></main>,
  errorComponent: () => <main className="empty"><h1>This page could not load</h1><a href="/">Reload</a></main>,
})
function Root() {
  return <html lang="en"><head><HeadContent /></head><body><div className="app-shell">
    <aside className="sidebar"><Link to="/" className="brand" aria-label="hopon home"><span className="brand-mark">h<span>↗</span></span>hopon<span className="brand-dot">.</span></Link>
      <nav aria-label="Main navigation"><Link to="/" activeOptions={{ exact: true }} activeProps={{ className: 'selected' }}><span aria-hidden="true">◈</span> Discover</Link><Link to="/create" activeProps={{ className: 'selected' }}><span aria-hidden="true">✳</span> Create</Link></nav>
      <div className="sidebar-note"><span className="tiny-label">SMALL GAMES. BIG IDEAS.</span><p>One little idea.<br />A whole new world.</p><span className="edition">PLAY / CREATE / REPEAT</span></div>
    </aside><div className="main-shell"><Outlet /></div></div><Scripts /></body></html>
}
