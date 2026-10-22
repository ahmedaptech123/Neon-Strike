import type { ReactNode } from "react";
import type { Stats } from "../game/Game";

export interface FeedItem {
  id: number;
  text: string;
  color: string;
}

export interface HitState {
  key: number;
  headshot: boolean;
  kill: boolean;
}

/* ------------------------------------------------------------------ */
/*  In-game HUD                                                         */
/* ------------------------------------------------------------------ */

export function HUD({
  stats,
  hit,
  damageKey,
  feed,
}: {
  stats: Stats;
  hit: HitState;
  damageKey: number;
  feed: FeedItem[];
}) {
  const healthPct = (stats.health / stats.maxHealth) * 100;
  const healthColor =
    healthPct > 60 ? "bg-emerald-400" : healthPct > 30 ? "bg-amber-400" : "bg-rose-500";
  const hitColor = hit.kill || hit.headshot ? "#f87171" : "#ffffff";

  return (
    <div className="pointer-events-none absolute inset-0 select-none font-mono text-white">
      {/* damage flash */}
      {damageKey > 0 && <div key={damageKey} className="damage-flash absolute inset-0" />}

      {/* low health vignette */}
      {stats.health < 30 && (
        <div className="absolute inset-0 animate-pulse shadow-[inset_0_0_140px_rgba(239,68,68,0.5)]" />
      )}

      {/* crosshair */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
        <svg width="40" height="40" viewBox="0 0 40 40" className="block drop-shadow-[0_0_2px_rgba(0,0,0,0.9)]">
          <g stroke="white" strokeWidth="2" strokeLinecap="round" opacity="0.9">
            <line x1="20" y1="10" x2="20" y2="16" />
            <line x1="20" y1="24" x2="20" y2="30" />
            <line x1="10" y1="20" x2="16" y2="20" />
            <line x1="24" y1="20" x2="30" y2="20" />
          </g>
          <circle cx="20" cy="20" r="1.3" fill="white" />
        </svg>
      </div>

      {/* hit marker */}
      {hit.key > 0 && (
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <svg key={hit.key} width="40" height="40" viewBox="0 0 40 40" className="hitmarker block">
            <g stroke={hitColor} strokeWidth="2.5" strokeLinecap="round">
              <line x1="12" y1="12" x2="17" y2="17" />
              <line x1="28" y1="12" x2="23" y2="17" />
              <line x1="12" y1="28" x2="17" y2="23" />
              <line x1="28" y1="28" x2="23" y2="23" />
            </g>
          </svg>
        </div>
      )}

      {/* wave panel */}
      <div className="absolute left-5 top-5 rounded-lg border border-white/10 bg-black/40 px-4 py-3 backdrop-blur">
        <div className="text-[11px] tracking-[0.3em] text-cyan-300">WAVE</div>
        <div className="text-3xl font-black leading-none">{stats.wave}</div>
        <div className="mt-1 text-xs text-white/60">Hostiles: {stats.enemiesLeft}</div>
      </div>

      {/* score panel */}
      <div className="absolute right-5 top-5 rounded-lg border border-white/10 bg-black/40 px-4 py-3 text-right backdrop-blur">
        <div className="text-[11px] tracking-[0.3em] text-amber-300">SCORE</div>
        <div className="text-3xl font-black leading-none">{stats.score.toLocaleString()}</div>
        <div className="mt-1 text-xs text-white/60">Kills: {stats.kills}</div>
      </div>

      {/* kill / event feed */}
      <div className="absolute left-1/2 top-24 flex -translate-x-1/2 flex-col items-center gap-2">
        {feed.map((f) => (
          <div
            key={f.id}
            className="feed-item rounded-md bg-black/50 px-4 py-1 text-sm font-bold tracking-wide backdrop-blur"
            style={{ color: f.color }}
          >
            {f.text}
          </div>
        ))}
      </div>

      {/* health */}
      <div className="absolute bottom-5 left-5 w-64 rounded-lg border border-white/10 bg-black/40 p-4 backdrop-blur">
        <div className="flex justify-between text-xs tracking-widest text-white/70">
          <span>HEALTH</span>
          <span className="font-bold text-white">{stats.health}</span>
        </div>
        <div className="mt-2 h-3 overflow-hidden rounded-full bg-white/10">
          <div
            className={`h-full rounded-full transition-all duration-200 ${healthColor}`}
            style={{ width: `${Math.max(0, healthPct)}%` }}
          />
        </div>
      </div>

      {/* ammo */}
      <div className="absolute bottom-5 right-5 rounded-lg border border-white/10 bg-black/40 px-5 py-3 text-right backdrop-blur">
        <div className="text-[11px] tracking-widest text-white/60">
          {stats.reloading ? "RELOADING…" : stats.ammo === 0 ? "EMPTY — PRESS R" : "AMMO"}
        </div>
        <div className="text-4xl font-black leading-none">
          <span className={stats.ammo === 0 ? "text-rose-400" : ""}>{stats.ammo}</span>
          <span className="text-xl text-white/50"> / {stats.reserve}</span>
        </div>
      </div>

      {/* controls hint */}
      <div className="absolute bottom-6 left-1/2 hidden -translate-x-1/2 text-[11px] text-white/50 md:block">
        WASD move · SPACE jump · SHIFT sprint · CLICK fire · R reload · ESC pause
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Menus                                                               */
/* ------------------------------------------------------------------ */

function Overlay({ children }: { children: ReactNode }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-slate-950/70 p-6 backdrop-blur-sm">
      {children}
    </div>
  );
}

const CONTROLS: [string, string][] = [
  ["W A S D", "Move"],
  ["Mouse", "Look around"],
  ["Left click", "Fire (hold for auto)"],
  ["R", "Reload"],
  ["Space", "Jump"],
  ["Shift", "Sprint"],
  ["Esc", "Pause"],
];

export function StartScreen({ onStart }: { onStart: () => void }) {
  return (
    <Overlay>
      <div className="w-full max-w-xl rounded-2xl border border-white/10 bg-slate-900/80 p-8 text-center text-white shadow-2xl shadow-cyan-900/40">
        <div className="text-[11px] tracking-[0.5em] text-cyan-300">FIRST PERSON SHOOTER</div>
        <h1 className="mt-2 bg-gradient-to-r from-cyan-300 via-fuchsia-400 to-amber-300 bg-clip-text text-6xl font-black tracking-tight text-transparent">
          NEON STRIKE
        </h1>
        <p className="mt-3 text-slate-300">
          Hold the arena. Survive escalating waves of grunts and chargers. Headshots deal double damage.
        </p>

        <div className="mt-6 grid grid-cols-2 gap-x-6 gap-y-2 rounded-xl bg-black/30 p-4 text-left text-sm">
          {CONTROLS.map(([key, action]) => (
            <div key={key} className="flex items-center justify-between gap-3 border-b border-white/5 py-1">
              <kbd className="rounded bg-white/10 px-2 py-0.5 font-mono text-xs text-cyan-200">{key}</kbd>
              <span className="text-slate-300">{action}</span>
            </div>
          ))}
        </div>

        <button
          onClick={onStart}
          className="mt-8 w-full cursor-pointer rounded-xl bg-gradient-to-r from-cyan-500 to-fuchsia-600 px-8 py-4 text-lg font-extrabold tracking-widest text-white shadow-lg shadow-fuchsia-900/40 transition hover:scale-[1.02] hover:brightness-110 active:scale-[0.99]"
        >
          DEPLOY
        </button>
        <p className="mt-3 text-xs text-slate-500">Your mouse will be captured. Press Esc at any time to pause.</p>
      </div>
    </Overlay>
  );
}

export function PauseScreen({ onResume, onRestart }: { onResume: () => void; onRestart: () => void }) {
  return (
    <Overlay>
      <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-slate-900/85 p-8 text-center text-white shadow-2xl">
        <div className="text-[11px] tracking-[0.5em] text-cyan-300">SYSTEM HALTED</div>
        <h2 className="mt-2 text-4xl font-black tracking-tight">PAUSED</h2>
        <div className="mt-6 space-y-3">
          <button
            onClick={onResume}
            className="w-full cursor-pointer rounded-xl bg-cyan-500 px-6 py-3 font-bold tracking-wide text-slate-950 transition hover:bg-cyan-400"
          >
            RESUME
          </button>
          <button
            onClick={onRestart}
            className="w-full cursor-pointer rounded-xl border border-white/15 bg-white/5 px-6 py-3 font-semibold tracking-wide text-white transition hover:bg-white/10"
          >
            RESTART RUN
          </button>
        </div>
      </div>
    </Overlay>
  );
}

export function GameOverScreen({ stats, onRestart }: { stats: Stats; onRestart: () => void }) {
  return (
    <Overlay>
      <div className="w-full max-w-sm rounded-2xl border border-rose-500/30 bg-slate-900/85 p-8 text-center text-white shadow-2xl shadow-rose-900/40">
        <div className="text-[11px] tracking-[0.5em] text-rose-300">MISSION FAILED</div>
        <h2 className="mt-2 text-5xl font-black tracking-tight text-rose-500">YOU DIED</h2>
        <div className="mt-6 grid grid-cols-3 gap-3">
          <div className="rounded-xl bg-black/30 p-3">
            <div className="text-[10px] tracking-widest text-slate-400">WAVE</div>
            <div className="text-2xl font-black text-cyan-300">{stats.wave}</div>
          </div>
          <div className="rounded-xl bg-black/30 p-3">
            <div className="text-[10px] tracking-widest text-slate-400">KILLS</div>
            <div className="text-2xl font-black text-rose-300">{stats.kills}</div>
          </div>
          <div className="rounded-xl bg-black/30 p-3">
            <div className="text-[10px] tracking-widest text-slate-400">SCORE</div>
            <div className="text-2xl font-black text-amber-300">{stats.score.toLocaleString()}</div>
          </div>
        </div>
        <button
          onClick={onRestart}
          className="mt-8 w-full cursor-pointer rounded-xl bg-gradient-to-r from-cyan-500 to-fuchsia-600 px-6 py-3 text-lg font-extrabold tracking-widest text-white transition hover:brightness-110"
        >
          PLAY AGAIN
        </button>
      </div>
    </Overlay>
  );
}
