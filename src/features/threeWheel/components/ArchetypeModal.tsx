import React from "react";
import {
  ARCHETYPE_DEFINITIONS,
  ARCHETYPE_IDS,
  type ArchetypeId,
} from "../../../game/archetypes";

export type LegacySide = "player" | "enemy";

interface ArchetypeModalProps {
  isMultiplayer: boolean;
  hudColors: Record<LegacySide, string>;
  localSide: LegacySide;
  remoteSide: LegacySide;
  namesBySide: Record<LegacySide, string>;
  localSelection: ArchetypeId | null;
  remoteSelection: ArchetypeId | null;
  localReady: boolean;
  remoteReady: boolean;
  localSpells: string[];
  remoteSpells: string[];
  onSelect: (id: ArchetypeId) => void;
  onReady: () => void;
  readyButtonLabel: string;
  readyButtonDisabled: boolean;
}

const formatSpellId = (spellId: string) =>
  spellId
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/(^|\s)([a-z])/g, (_, prefix: string, char: string) => prefix + char.toUpperCase());

const ArchetypeModal: React.FC<ArchetypeModalProps> = ({
  isMultiplayer,
  hudColors,
  localSide,
  remoteSide,
  namesBySide,
  localSelection,
  remoteSelection,
  localReady,
  remoteReady,
  localSpells,
  remoteSpells,
  onSelect,
  onReady,
  readyButtonLabel,
  readyButtonDisabled,
}) => {
  const localArchetypeDef = localSelection
    ? ARCHETYPE_DEFINITIONS[localSelection]
    : null;
  const remoteArchetypeDef = remoteSelection
    ? ARCHETYPE_DEFINITIONS[remoteSelection]
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm px-4 py-6">
      <div className="w-full max-w-4xl space-y-6 rounded-2xl border border-slate-700 bg-slate-900/95 p-6 shadow-2xl">
        <div className="space-y-2 text-center">
          <h2 className="text-2xl font-semibold text-amber-200">Choose Your Archetype</h2>
          <p className="text-sm text-slate-200/80">
            Archetypes determine which spells appear in your grimoire. Pick one, then press {" "}
            {isMultiplayer ? "Ready" : "Next"} to begin.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          {ARCHETYPE_IDS.map((id) => {
            const def = ARCHETYPE_DEFINITIONS[id];
            const isLocalChoice = localSelection === id;
            const isRemoteChoice = remoteSelection === id;
            return (
              <div
                key={id}
                className="relative flex h-full flex-col rounded-xl border border-slate-700/70 bg-slate-800/70 p-4 shadow"
                style={{
                  borderColor: isLocalChoice
                    ? hudColors[localSide]
                    : isRemoteChoice
                    ? hudColors[remoteSide]
                    : undefined,
                }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-lg font-semibold text-slate-100">{def.name}</div>
                    <p className="mt-1 text-xs text-slate-300/80 leading-snug">{def.description}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1 text-[10px] font-semibold uppercase tracking-wide">
                    {isLocalChoice && (
                      <span
                        className="rounded-full px-2 py-0.5"
                        style={{
                          background: `${hudColors[localSide]}22`,
                          color: hudColors[localSide],
                        }}
                      >
                        You
                      </span>
                    )}
                    {isRemoteChoice && (
                      <span
                        className="rounded-full px-2 py-0.5"
                        style={{
                          background: `${hudColors[remoteSide]}22`,
                          color: hudColors[remoteSide],
                        }}
                      >
                        {namesBySide[remoteSide]}
                      </span>
                    )}
                  </div>
                </div>

                <div className="mt-3 flex-1 rounded-lg border border-slate-700/70 bg-slate-900/60 p-3">
                  <div className="text-xs font-semibold uppercase text-slate-300/80">Spells</div>
                  <ul className="mt-2 space-y-1 text-xs text-slate-100/90">
                    {def.spellIds.map((spell) => (
                      <li key={spell} className="flex items-center gap-2">
                        <span className="h-1.5 w-1.5 rounded-full bg-slate-500" aria-hidden />
                        <span>{formatSpellId(spell)}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <button
                  onClick={() => onSelect(id)}
                  disabled={isLocalChoice}
                  className="mt-4 rounded-lg border border-amber-400/70 px-3 py-1.5 text-sm font-semibold text-amber-100 transition hover:bg-amber-400/10 disabled:cursor-not-allowed disabled:border-amber-200/40 disabled:text-amber-200/70"
                >
                  {isLocalChoice ? "Selected" : "Choose"}
                </button>
              </div>
            );
          })}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-slate-700/70 bg-slate-900/70 p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-semibold text-slate-100">{namesBySide[localSide]}</div>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                  localReady ? "bg-emerald-500/20 text-emerald-300" : "bg-slate-700/60 text-slate-300"
                }`}
              >
                {localReady ? "Ready" : "Not Ready"}
              </span>
            </div>
            <div className="mt-2 text-xs text-slate-300/90">
              {localArchetypeDef ? localArchetypeDef.name : "Select an archetype"}
            </div>
            <ul className="mt-3 space-y-1 text-xs text-slate-100/90">
              {localSpells.length === 0 ? (
                <li className="italic text-slate-400">No spells yet</li>
              ) : (
                localSpells.map((spell) => <li key={spell}>{formatSpellId(spell)}</li>)
              )}
            </ul>
          </div>

          <div className="rounded-xl border border-slate-700/70 bg-slate-900/70 p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-semibold text-slate-100">{namesBySide[remoteSide]}</div>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                  remoteReady ? "bg-emerald-500/20 text-emerald-300" : "bg-slate-700/60 text-slate-300"
                }`}
              >
                {remoteReady ? "Ready" : "Waiting"}
              </span>
            </div>
            <div className="mt-2 text-xs text-slate-300/90">
              {remoteArchetypeDef ? remoteArchetypeDef.name : "Awaiting selection"}
            </div>
            <ul className="mt-3 space-y-1 text-xs text-slate-100/90">
              {remoteSpells.length === 0 ? (
                <li className="italic text-slate-400">Hidden</li>
              ) : (
                remoteSpells.map((spell) => <li key={spell}>{formatSpellId(spell)}</li>)
              )}
            </ul>
          </div>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm text-slate-300/90">
            {isMultiplayer
              ? remoteReady
                ? `${namesBySide[remoteSide]} is ready.`
                : `Waiting for ${namesBySide[remoteSide]}...`
              : remoteArchetypeDef
              ? `${namesBySide[remoteSide]} is ready.`
              : `${namesBySide[remoteSide]} is choosing an archetype...`}
          </div>
          <div className="flex justify-end gap-2">
            <button
              onClick={onReady}
              disabled={readyButtonDisabled}
              className="rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-slate-900 transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:bg-amber-200/80"
            >
              {readyButtonLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ArchetypeModal;
