import React from "react";
import type { Phase, Players } from "../../../game/types";
import type { LegacySide } from "./WheelPanel";

interface Theme {
  panelBg: string;
  panelBorder: string;
  slotBg: string;
  slotBorder: string;
  brass: string;
  textWarm: string;
}

interface HUDPanelsProps {
  manaPools: { player: number; enemy: number };
  isGrimoireMode: boolean;
  reserveSums: { player: number; enemy: number } | null;
  players: Players;
  hudColors: Record<LegacySide, string>;
  wins: { player: number; enemy: number };
  initiative: LegacySide;
  localLegacySide: LegacySide;
  phase: Phase;
  theme: Theme;
}

const HUDPanels: React.FC<HUDPanelsProps> = ({
  manaPools,
  isGrimoireMode,
  reserveSums,
  players,
  hudColors,
  wins,
  initiative,
  localLegacySide,
  phase,
  theme,
}) => {
  const rsP = reserveSums ? reserveSums.player : null;
  const rsE = reserveSums ? reserveSums.enemy : null;

  const Panel = ({ side }: { side: LegacySide }) => {
    const isPlayer = side === "player";
    const color = isPlayer ? players.left.color ?? hudColors.player : players.right.color ?? hudColors.enemy;
    const name = isPlayer ? players.left.name : players.right.name;
    const win = isPlayer ? wins.player : wins.enemy;
    const manaCount = isPlayer ? manaPools.player : manaPools.enemy;
    const rs = isPlayer ? rsP : rsE;
    const hasInit = initiative === side;
    const isReserveVisible =
      (phase === "showEnemy" || phase === "anim" || phase === "roundEnd" || phase === "ended") && rs !== null;

    return (
      <div className="flex h-full flex-col items-center w-full">
        <div
          className="relative flex min-w-0 items-center gap-2 rounded-lg border px-2 py-1 text-[12px] shadow w-full"
          style={{
            maxWidth: "100%",
            background: theme.panelBg,
            borderColor: theme.panelBorder,
            color: theme.textWarm,
          }}
        >
          <div className="w-1.5 h-6 rounded" style={{ background: color }} />
          <div className="flex items-center min-w-0 flex-1">
            <span className="truncate block font-semibold">{name}</span>
            {(isPlayer ? "player" : "enemy") === localLegacySide && (
              <span className="ml-2 rounded bg-white/10 px-1.5 py-0.5 text-[10px]">You</span>
            )}
          </div>
          <div className="flex items-center gap-3 ml-1 flex-shrink-0">
            <div className="flex items-center gap-1">
              <span className="opacity-80">Wins</span>
              <span className="text-base font-extrabold tabular-nums">{win}</span>
            </div>
            <div
              className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold transition-opacity ${
                isGrimoireMode ? "opacity-100 visible" : "opacity-0 invisible"
              }`}
              style={{
                background: "#1b1209ee",
                borderColor: theme.slotBorder,
                color: theme.textWarm,
                minWidth: "62px",
                justifyContent: "center",
              }}
              aria-hidden={!isGrimoireMode}
              title={isGrimoireMode ? `Mana: ${manaCount}` : undefined}
            >
              <span role="img" aria-label="Mana" className="text-sm leading-none">
                🔮
              </span>
              <span className="tabular-nums text-sm leading-none">{manaCount}</span>
            </div>
          </div>
          <div
            className={`ml-2 hidden sm:flex rounded-full border px-2 py-0.5 text-[11px] overflow-hidden text-ellipsis whitespace-nowrap transition-opacity ${
              isReserveVisible ? "opacity-100 visible" : "opacity-0 invisible"
            }`}
            style={{
              maxWidth: "44vw",
              minWidth: "90px",
              background: "#1b1209ee",
              borderColor: theme.slotBorder,
              color: theme.textWarm,
            }}
            title={rs !== null ? `Reserve: ${rs}` : undefined}
          >
            Reserve: <span className="font-bold tabular-nums">{rs ?? 0}</span>
          </div>
          {hasInit && (
            <span
              aria-label="Has initiative"
              className="absolute -top-1 -right-1 leading-none select-none"
              style={{
                fontSize: 24,
                filter: "drop-shadow(0 1px 1px rgba(0,0,0,.6))",
              }}
            >
              ⚑
            </span>
          )}
        </div>

        {isReserveVisible && (
          <div className="mt-1 w-full sm:hidden">
            <div className="w-full flex flex-col gap-1">
              <div
                className="w-full rounded-full border px-3 py-1 text-[11px] text-center"
                style={{
                  background: "#1b1209ee",
                  borderColor: theme.slotBorder,
                  color: theme.textWarm,
                }}
                title={rs !== null ? `Reserve: ${rs}` : undefined}
              >
                Reserve: <span className="font-bold tabular-nums">{rs ?? 0}</span>
              </div>
              <div
                className={`w-full rounded-full border px-3 py-1 text-[11px] text-center transition-opacity ${
                  isGrimoireMode ? "opacity-100 visible" : "opacity-0 invisible"
                }`}
                style={{
                  background: "#1b1209ee",
                  borderColor: theme.slotBorder,
                  color: theme.textWarm,
                }}
                aria-hidden={!isGrimoireMode}
                title={isGrimoireMode ? `Mana: ${manaCount}` : undefined}
              >
                <span className="font-semibold">Mana:</span>{" "}
                <span className="font-bold tabular-nums">{manaCount}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="w-full flex flex-col items-center">
      <div className="grid w-full max-w-[900px] grid-cols-2 items-stretch gap-2 overflow-x-hidden">
        <div className="min-w-0 w-full max-w-[420px] mx-auto h-full">
          <Panel side="player" />
        </div>
        <div className="min-w-0 w-full max-w-[420px] mx-auto h-full">
          <Panel side="enemy" />
        </div>
      </div>
    </div>
  );
};

export default HUDPanels;
