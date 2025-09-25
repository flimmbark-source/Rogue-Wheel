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
  onPlayerManaToggle?: () => void;
  isGrimoireOpen?: boolean;
  playerManaButtonRef?: React.Ref<HTMLButtonElement>;
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
  onPlayerManaToggle,
  isGrimoireOpen,
  playerManaButtonRef,
}) => {
  const rsP = reserveSums ? reserveSums.player : null;
  const rsE = reserveSums ? reserveSums.enemy : null;

  const Panel = ({ side }: { side: LegacySide }) => {
    const isPlayer = side === "player";
    const color = isPlayer ? players.left.color ?? hudColors.player : players.right.color ?? hudColors.enemy;
    const name = isPlayer ? players.left.name : players.right.name;
    const win = isPlayer ? wins.player : wins.enemy;
    const rs = isPlayer ? rsP : rsE;
    const hasInit = initiative === side;
    const isReserveVisible =
      (phase === "showEnemy" || phase === "anim" || phase === "roundEnd" || phase === "ended") && rs !== null;

    const manaCount = isPlayer ? manaPools.player : manaPools.enemy;

    const manaPillBaseClassName = `flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold transition-opacity flex-shrink-0 ${
      isGrimoireMode ? "opacity-100 visible" : "opacity-0 invisible"
    }`;

    const manaPillStyle: React.CSSProperties = {
      background: "#1b1209ee",
      borderColor: theme.slotBorder,
      color: theme.textWarm,
      minWidth: "62px",
      justifyContent: "center",
    };

    const manaPillContent = (
      <>
        <span role="img" aria-label="Mana" className="text-sm leading-none">
          🔮
        </span>
        <span className="tabular-nums text-sm leading-none">{manaCount}</span>
      </>
    );

    const manaRef = isPlayer ? playerManaButtonRef : undefined;

    const renderManaPill = () => {
      if (!isGrimoireMode) {
        return (
          <div
            className={`${manaPillBaseClassName} pointer-events-none`}
            style={manaPillStyle}
            aria-hidden
          >
            {manaPillContent}
          </div>
        );
      }

      if (isPlayer && onPlayerManaToggle) {
        return (
          <button
            type="button"
            onClick={onPlayerManaToggle}
            className={`${manaPillBaseClassName} cursor-pointer hover:bg-[#2b1d10ee] focus:outline-none focus:ring-2 focus:ring-sky-500/70 focus:ring-offset-2 focus:ring-offset-slate-900 ${
              isGrimoireOpen ? "ring-2 ring-sky-400/70" : ""
            }`}
            style={manaPillStyle}
            title={`Mana: ${manaCount}`}
            aria-pressed={isGrimoireOpen}
            aria-label={`Mana: ${manaCount}. ${isGrimoireOpen ? "Hide" : "Show"} grimoire.`}
            ref={manaRef}
          >
            {manaPillContent}
          </button>
        );
      }

      return (
        <div
          className={manaPillBaseClassName}
          style={manaPillStyle}
          aria-hidden={!isGrimoireMode}
          title={`Mana: ${manaCount}`}
        >
          {manaPillContent}
        </div>
      );
    };

    return (
      <div className="flex h-full flex-col items-start w-full">
        <div
          className="relative flex min-w-0 items-start sm:items-center gap-2 rounded-lg border px-0.5 py-0.5 sm:py-1 text-[12px] shadow w-full flex-wrap sm:flex-nowrap min-h-[40px] sm:min-h-0"
          style={{
            maxWidth: "100%",
            background: theme.panelBg,
            borderColor: theme.panelBorder,
            color: theme.textWarm,
          }}
        >
          <div className="w-1.5 rounded self-stretch sm:self-auto sm:h-6" style={{ background: color }} />
          <div className="flex items-center min-w-0 flex-1 w-full sm:w-auto">
            <span className="truncate block font-semibold">{name}</span>
            {(isPlayer ? "player" : "enemy") === localLegacySide && (
              <span className="ml-2 rounded bg-white/10 px-1.5 py-0.5 text-[10px]">You</span>
            )}
          </div>
          <div className="flex items-start gap-2 ml-1 w-full justify-between sm:w-auto sm:justify-end flex-nowrap">
            <div className="flex flex-col flex-shrink-0 items-start sm:items-end">
              <div className="flex items-center gap-1">
                <span className="opacity-80">Wins</span>
                <span className="text-base font-extrabold tabular-nums">{win}</span>
              </div>
            </div>
            {isReserveVisible && (
              <div

                className="flex items-center gap-1 rounded-full border px-3 py-1 sm:px-2 sm:py-0.5 text-[11px] sm:max-w-[44vw] overflow-hidden text-ellipsis whitespace-nowrap flex-shrink-0"
                style={{
                  minWidth: "90px",
                  background: "#1b1209ee",
                  borderColor: theme.slotBorder,
                  color: theme.textWarm,
                }}
                title={rs !== null ? `Reserve: ${rs}` : undefined}
              >
                <span className="sm:hidden mr-1">Reserve:</span>
                <span className="hidden sm:inline">Reserve: </span>
                <span className="font-bold tabular-nums">{rs ?? 0}</span>
              </div>
            )}
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
        <div className="mt-1 self-start">
          {renderManaPill()}
        </div>
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
