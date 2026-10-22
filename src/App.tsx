import { useEffect, useRef, useState } from "react";
import { Game, type GameEvent, type Screen, type Stats } from "./game/Game";
import {
  GameOverScreen,
  HUD,
  PauseScreen,
  StartScreen,
  type FeedItem,
  type HitState,
} from "./components/GameUI";

const INITIAL_STATS: Stats = {
  health: 100,
  maxHealth: 100,
  ammo: 30,
  magSize: 30,
  reserve: 120,
  reloading: false,
  score: 0,
  kills: 0,
  wave: 1,
  enemiesLeft: 0,
};

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Game | null>(null);
  const feedId = useRef(0);

  const [screen, setScreen] = useState<Screen>("menu");
  const [stats, setStats] = useState<Stats>(INITIAL_STATS);
  const [hit, setHit] = useState<HitState>({ key: 0, headshot: false, kill: false });
  const [damageKey, setDamageKey] = useState(0);
  const [feed, setFeed] = useState<FeedItem[]>([]);

  useEffect(() => {
    const game = new Game(containerRef.current!, {
      onStats: setStats,
      onScreen: setScreen,
      onEvent: (e: GameEvent) => {
        switch (e.type) {
          case "hit":
            setHit((h) => ({ key: h.key + 1, headshot: e.headshot, kill: e.kill }));
            break;
          case "damage":
            setDamageKey((k) => k + 1);
            break;
          case "message": {
            const id = ++feedId.current;
            setFeed((f) => [...f.slice(-4), { id, text: e.text, color: e.color }]);
            window.setTimeout(() => {
              setFeed((f) => f.filter((item) => item.id !== id));
            }, 2400);
            break;
          }
        }
      },
    });
    gameRef.current = game;
    return () => {
      game.dispose();
      gameRef.current = null;
    };
  }, []);

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-slate-950">
      <div ref={containerRef} className="absolute inset-0" />

      {(screen === "playing" || screen === "paused") && (
        <HUD stats={stats} hit={hit} damageKey={damageKey} feed={feed} />
      )}

      {screen === "menu" && <StartScreen onStart={() => gameRef.current?.play()} />}

      {screen === "paused" && (
        <PauseScreen
          onResume={() => gameRef.current?.play()}
          onRestart={() => gameRef.current?.restart()}
        />
      )}

      {screen === "over" && (
        <GameOverScreen stats={stats} onRestart={() => gameRef.current?.play()} />
      )}
    </div>
  );
}
