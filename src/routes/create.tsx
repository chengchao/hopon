import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { api, post, type Game } from '../lib'
export const Route = createFileRoute('/create')({ component: Create })
const examples = ['A cat jumping on the moon. Tap to dodge meteors and collect stars.', 'A pixel-art fruit catcher. Move a basket to catch apples and avoid bombs.', 'An ocean animal memory game. Flip cards and find every matching pair to win.']
function Create() {
  const navigate = useNavigate()
  const [prompt, setPrompt] = useState('')
  const [draft, setDraft] = useState<Game | null>(null)
  const [busy, setBusy] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [error, setError] = useState('')
  const [previewKey, setPreviewKey] = useState(0)
  useEffect(() => {
    try { setPrompt(localStorage.getItem('hopon-prompt') || ''); const saved = JSON.parse(localStorage.getItem('hopon-draft') || 'null'); if (saved && Number.isSafeInteger(saved.id) && saved.id > 0 && typeof saved.title === 'string' && typeof saved.description === 'string') setDraft(saved) } catch { /* Storage can be disabled. */ }
  }, [])
  useEffect(() => {
    if (!busy) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault() }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [busy])
  async function generate(event: React.FormEvent) {
    event.preventDefault(); if (busy) return
    setBusy(true); setError('')
    try {
      await api('/api/session')
      const game = await api<Game>('/api/games', post({ prompt }))
      setDraft(game); setPreviewKey(key => key + 1)
      try { localStorage.setItem('hopon-draft', JSON.stringify(game)) } catch { /* Cookie remains the owner credential. */ }
    } catch (e) { setError((e as Error).message) }
    finally { setBusy(false) }
  }
  async function publish() {
    if (!draft || publishing) return
    setPublishing(true); setError('')
    try { await api(`/api/games/${draft.id}/publish`, post()); try { localStorage.removeItem('hopon-draft') } catch {} await navigate({ to: '/' }) }
    catch (e) { setError((e as Error).message) }
    finally { setPublishing(false) }
  }
  function changePrompt(value: string) { setPrompt(value); try { localStorage.setItem('hopon-prompt', value) } catch {} }
  return <main className="create-page"><header className="page-header"><div><span className="tiny-label">THE IDEA STUDIO</span><h1>Make your what-if playable<span className="accent">.</span></h1></div><span className="studio-badge">✳ Imagination: ready</span></header>
    <div className="studio-layout"><section className="composer"><span className="step-label">01 / START WITH AN IDEA</span><h2>What do you want to play?</h2><p className="muted">Describe the gameplay, the look, and a little twist. Let AI do the rest.</p>
      <form onSubmit={generate}><label className="sr-only" htmlFor="prompt">Game idea</label><textarea id="prompt" value={prompt} minLength={4} maxLength={2000} required disabled={busy || publishing} onChange={event => changePrompt(event.target.value)} placeholder="Imagine a cat on the moon. Tap to dodge meteors and collect stars…" /><div className="composer-controls"><span>{prompt.length} / 2000</span><button className="primary" disabled={busy || publishing || prompt.trim().length < 4}>{busy ? '✳ Creating…' : draft ? '✳ Generate again' : '✳ Create game'}</button></div></form>
      <span className="tiny-label inspiration-label">NEED A SPARK? TRY AN IDEA</span><div className="examples">{examples.map((example, index) => <button key={example} disabled={busy || publishing} onClick={() => changePrompt(example)}><span>{['☾', '❋', '▧'][index]}</span>{['Moon cat', 'Pixel fruit catcher', 'Ocean memory'][index]}<span>↗</span></button>)}</div>
      <p className="creator-note">Play it first. Publish when it feels right.<br />Your draft belongs to this browser.</p>
      {error && <div className="error" role="alert">{error}</div>}
      {busy && <div className="generating" role="status"><span className="spinner" />Turning your idea into a game. Keep this page open.<small>This can take a minute. Your previous draft stays safe until the new one is ready.</small></div>}
    </section><section className="preview-panel" aria-label="Game preview"><div className="preview-heading"><span className="step-label">02 / BRING IT TO LIFE</span>{draft && <button disabled={busy} onClick={() => setPreviewKey(key => key + 1)}>↻ Restart preview</button>}</div>
      <div className="preview-stage">{draft ? <iframe key={`${draft.id}-${previewKey}`} src={`/api/games/${draft.id}/document`} sandbox="allow-scripts" title={`Preview: ${draft.title}`} /> : <div className="preview-empty"><div className="imagination-shape">✳</div><h3>Your next favorite game<br />starts with a few words.</h3><p>Your creation will appear here.</p></div>}</div>
      <div className="publish-row"><div><strong>{draft?.title || 'Your game preview'}</strong><p>{draft ? 'Ready? Publish it for everyone to play.' : 'Imagine → Create → Play'}</p></div><button className="primary" disabled={!draft || busy || publishing} onClick={() => void publish()}>{publishing ? 'Publishing…' : 'Publish ↗'}</button></div>
    </section></div></main>
}
