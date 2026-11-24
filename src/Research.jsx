import { useEffect, useState } from 'react'
import { SET_PIECES } from '../shared/scenario.js'

const short = (id) => SET_PIECES[id]?.split(':')[0] ?? id

// Replays how the mission was chosen, from what the research run saved.
export default function Research({ scenario, close }) {
  const r = scenario.research
  const [step, setStep] = useState(0)
  useEffect(() => {
    if (step >= 4) return
    const t = setTimeout(() => setStep(step + 1), step === 0 ? 900 : 1900)
    return () => clearTimeout(t)
  }, [step])
  const max = Math.max(...r.board.map((b) => b.score), 1)
  return (
    <div className="research" onClick={close}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>How this mission was chosen</h2>
          <span><button onClick={() => setStep(0)}>Replay</button><button onClick={close}>Close</button></span>
        </header>
        <div className="rsteps">
          <section className={step >= 0 ? 'in' : ''}>
            <h3><b>1</b> Ask the web <em style={{ '--v': '#e86bff' }}>Telem</em></h3>
            <p className="dim">Neutral questions. None names a scene.</p>
            {r.queries.map((q) => <p key={q.q} className="q">“{q.q}” <small>{q.results} results</small></p>)}
          </section>
          <section className={step >= 1 ? 'in' : ''}>
            <h3><b>2</b> Keep what matters</h3>
            <div className="funnel">
              <div><strong>{r.found}</strong> results from {r.providers.length} search engines</div>
              <div style={{ width: '84%' }}><strong>{r.unique}</strong> different pages</div>
              <div style={{ width: '68%' }}><strong>{r.kept}</strong> about films</div>
            </div>
            <p className="dim">{r.providers.join(', ')}</p>
          </section>
          <section className={step >= 2 ? 'in' : ''}>
            <h3><b>3</b> Rank the spy moments <em style={{ '--v': '#ffc857' }}>Bruin ranks the same data</em></h3>
            {r.board.map((b, i) => (
              <div key={b.id} className={'rbar' + (i === 0 ? ' first' : '')}><span>{short(b.id)}</span><div className="bar"><i style={{ width: step >= 2 ? `${(b.score / max) * 100}%` : 0 }} /></div><small>{b.pages} pages</small></div>
            ))}
            <p className="dim">We count pages whose summary mentions each moment. Higher-ranked results count more.</p>
          </section>
          <section className={step >= 3 ? 'in' : ''}>
            <h3><b>4</b> Write the mission <em style={{ '--v': '#2ee6a6' }}>Runware</em></h3>
            <p className="pick">{scenario.title}</p>
            <p><b>{scenario.villain}:</b> “{scenario.villainLine}”</p>
            <p><b>Set piece:</b> {SET_PIECES[scenario.setPiece]}</p>
            <p className="dim">Sources:</p>
            {scenario.sources.slice(0, 3).map((u) => <a key={u.url} href={u.url} target="_blank" rel="noreferrer">{u.title}</a>)}
          </section>
        </div>
        <p className="dim">Run {new Date(scenario.researchedAt).toLocaleString()}. A small sample, so it guides the mission rather than proving what goes viral.</p>
      </div>
    </div>
  )
}
