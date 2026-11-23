# Nine Lies

A 3D co-op heist for humans and AI agents. Five ninja spy cats break into a dog villain's lair to steal the Red Dot, a giant laser pointer. One cat works for the dogs. Everyone has one bullet. When a cat goes missing, nobody knows whether it is dead, caged or lying.

Built at the Multiplayer AI Hackathon (Nov 23, 2026), Track 2: co-op games with agents. All code was written at the event.

## Play

```bash
npm install
npm start            # builds, then serves http://localhost:8787
```

Open the page and choose **Play now** (alone with agents, no server features needed) or **Play with friends**. A second player can scan the QR code and become the **hacker** on a phone. Any empty seat is played by an agent.

| Key | Action |
|---|---|
| WASD, Shift, Ctrl | move, sprint (loud), sneak |
| Space | claw: silent kill from behind, scuffle from the front |
| F | your one bullet: everyone hears which direction it came from |
| E | throw yarn to lure dogs |
| Q | radio wheel: call to everyone or whisper to one cat |
| V, X | call a vote, run an alibi scan |

## How a match works

1. Hold both generators at the same moment, which forces the crew to split up.
2. Take the core from the vault. The carrier is slow and cannot fight.
3. Reach the helipad before the weapon fires.

The mole wins if time runs out or the crew is wiped out. Dogs let the mole pass, and the mole can leak routes to the dog captain.

## How the agents work

- **Plan (LLM):** every 10 seconds or so, or when something happens, an agent gets what *it* saw, heard or was told, and returns a goal, what to say, what to lie about, and a reason.
- **Move (code):** A* paths, vision cones, fleeing and stalking run on plain code, so agents never freeze. If the LLM is slow or off, a rule-based brain takes over.
- **Knowledge is private:** agents only know their own sightings and the messages they received. The killer can fake an alibi, and only someone who saw otherwise can break it.
- **Ledger:** every decision is logged with its reason and whether it came from the LLM or the rules. It is sealed during play and opened at the end. Spectators see it live.
- **Learning:** mole tactics compete across matches in a small Thompson-sampling bandit. The end screen shows the odds.

## Sponsor tools

Each one is optional at run time; `/api/status` shows which are live.

| Tool | What it does here | Code |
|---|---|---|
| **Bruin** | The alibi scan runs a live query through Bruin's Query API and shows its SQL. Mole learning is read back from a Bruin view. Seven assets with 17 quality checks. Before each match the dog captain also queries past heists through Bruin. | `bruin/`, `server/warehouse.js` |
| **Band** | Each cat and the dog captain is a Band agent. Radio calls and leaks between agents travel as Band messages; a whisper mentions one agent, so only that agent gets it. | `server/band.js` |
| **Runware** | Agent and captain decisions | `server/llm.js` |
| **Telem** | The viral scenario engine searches the live web for the spy moments people love and picks the next mission, with sources | `scripts/research.mjs` |
| **LingCode** | Hosts the browser version | |
| **AdaL** | Trailer and demo video | |

## Tests

```bash
npm test                     # plays 30 full matches with rule-based agents
node test/multiplayer.mjs    # two runners and a hacker against a running server
```

## Assets

All models are built in code from primitives. All sound effects are synthesized in the browser. No third-party art or audio.
