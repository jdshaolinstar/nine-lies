import { clock, Radio, ScanBox, VoteResult } from './Hud.jsx'
import { roomName } from '../shared/map.js'

const planText = (p, cats) => {
  if (!p) return 'thinking…'
  const who = cats.find((c) => c.id === p.cat)?.name
  return { gennorth: 'Hold North Generator', gensouth: 'Hold South Generator', core: 'Grab the core', escape: 'Run for the helipad', goto: `Go to ${roomName(p.room)}` }[p.goal] ?? `${p.goal} ${who ?? ''}`
}

// Spectators see everything, including who the mole is.
export default function Director({ s, scan, services }) {
  return (
    <>
      <div className="top"><div className={'timer' + (s.timeLeft < 45 ? ' hot' : '')}>{clock(s.timeLeft)}</div><div className="objective">Spectator view: you can see the mole. The crew can&apos;t.</div></div>
      <div className="minds">
        {s.cats.map((c) => (
          <div key={c.id} className={'mind ' + c.state + (c.mole ? ' mole' : '')} style={{ '--c': c.color }}>
            <b>{c.name}{c.mole ? ' · MOLE' : ''}{c.human ? ' · human' : ''}</b>
            {c.state === 'ok'
              ? <><span>{c.human ? 'playing' : planText(c.plan, s.cats)} {c.plan?.source === 'llm' && <em>LLM</em>}</span><small>{!c.human && c.plan?.reason}</small></>
              : <span>{c.state === 'dead' ? 'dead' : c.state === 'captured' ? 'caged' : 'cut loose'}</span>}
          </div>
        ))}
      </div>
      <Ledger s={s} />
      <Radio s={s} />
      <ScanBox scan={scan} />
      <VoteResult s={s} />
      {services && <p className="svc corner">{Object.entries(services).map(([k, v]) => <span key={k} className={v ? 'on' : ''}>{k}</span>)}</p>}
    </>
  )
}

export function Ledger({ s, full }) {
  const name = (id) => s.crew.find((c) => c.id === id)?.name ?? 'Captain'
  const color = (id) => s.crew.find((c) => c.id === id)?.color ?? '#ff9a30'
  return (
    <div className={'ledger' + (full ? ' full' : '')}>
      <h3>Decision ledger</h3>
      {s.ledger.slice(full ? -80 : -9).map((l, i) => (
        <p key={i} className={l.secret ? 'secret' : ''}><time>{clock(l.t)}</time><b style={{ color: color(l.who) }}>{name(l.who)}</b> {l.goal} <i>{l.reason}</i>{l.source === 'llm' && <em>LLM</em>}</p>
      ))}
    </div>
  )
}
