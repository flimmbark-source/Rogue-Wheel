import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Realtime } from "ably";
import type { PresenceMessage } from "ably";

import { TARGET_WINS, type Players, type Side } from "./game/types";
import {
  getMultiplayerSnapshot,
  syncMultiplayerSnapshot,
  type MultiplayerSnapshot,
} from "./player/profileStore";

// ----- Start payload now includes targetWins (wins goal) -----

import {
  MATCH_MODE_PRESETS,
  DEFAULT_MATCH_MODE_ID,
  resolveMatchMode,
  type MatchModeId,
  type Players,
  type Side,
} from "./game/types";

// ----- Start payload now includes match settings -----

type StartMessagePayload = {
  roomCode: string;
  seed: number;
  hostId: string;
  players: Players;          // { left: {id,name,color}, right: {…} }
  playersArr?: { clientId: string; name: string }[]; // optional: raw list for debugging
  targetWins: number;        // 👈 merged feature: game wins goal

  snapshot: MultiplayerSnapshot;

  modeId: MatchModeId;
  timerSeconds: number | null;

};

type StartPayload = StartMessagePayload & {
  localSide: Side;           // side for THIS client
  channelName: string;       // reuse existing channel without reattaching
  channel: ReturnType<Realtime["channels"]["get"]>;
  clientId: string;          // keep track of our Ably client id
  ably: Realtime;            // active realtime connection
};

type ConnectOptions = {
  requireExistingMembers?: boolean;
};

export default function MultiplayerRoute({
  onBack,
  onStart,
}: {
  onBack: () => void;
  onStart: (payload: StartPayload) => void;
}) {
  // ---- UI state ----
  const [mode, setMode] = useState<"idle" | "creating" | "joining" | "in-room">("idle");
  const [roomCode, setRoomCode] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [name, setName] = useState<string>(() => defaultName());
  const [status, setStatus] = useState<string>("");

  // Match mode (host controls)
  const [selectedModeId, setSelectedModeId] = useState<MatchModeId>(DEFAULT_MATCH_MODE_ID);
  const selectedMode = MATCH_MODE_PRESETS[selectedModeId] ?? MATCH_MODE_PRESETS[DEFAULT_MATCH_MODE_ID];
  const modeOptions = useMemo(() => Object.values(MATCH_MODE_PRESETS), []);
  const selectedTargetWins = selectedMode.targetWins;
  const selectedTimerSeconds =
    typeof selectedMode.timerSeconds === "number" && selectedMode.timerSeconds > 0
      ? Math.round(selectedMode.timerSeconds)
      : null;

  // ---- Ably core refs ----
  const ablyRef = useRef<Realtime | null>(null);
  const channelRef = useRef<ReturnType<Realtime["channels"]["get"]> | null>(null);

  // members list (UI) and authoritative presence map
  const [members, setMembers] = useState<
    { clientId: string; name: string; modeId?: MatchModeId }[]
  >([]);
  const clientId = useMemo(() => uid4(), []);

  type MemberEntry = {
    clientId: string;
    name: string;
    ts: number;
    modeId?: MatchModeId;
  };
  const memberMapRef = useRef<Map<string, MemberEntry>>(new Map());

  // Commit member map -> UI array; also sync host's match mode to all clients
  const commitMembers = useCallback((map: Map<string, MemberEntry>) => {
    const ordered = Array.from(map.values()).sort((a, b) => {
      if (a.ts !== b.ts) return a.ts - b.ts;
      return a.clientId.localeCompare(b.clientId);
    });

    setMembers(
      ordered.map(({ clientId, name, modeId }) => ({ clientId, name, modeId }))
    );

    // host is first; mirror host's mode locally
    const host = ordered[0];
    const hostModeId = host?.modeId;
    if (hostModeId) {
      const resolved = resolveMatchMode(hostModeId).id;
      setSelectedModeId(resolved);
    }
  }, [setSelectedModeId]);

  const applySnapshot = useCallback(
  (list: PresenceMessage[] | undefined | null) => {
    const prevMap = memberMapRef.current;
    const next = new Map<string, MemberEntry>();

    if (Array.isArray(list)) {
      for (const msg of list) {
        if (!msg?.clientId) continue;
        const data = (msg.data ?? {}) as any;
        const rawModeId = typeof data?.modeId === "string" ? data.modeId : undefined;
        const prev = prevMap.get(msg.clientId);
        const serverTs = typeof msg.timestamp === "number" ? msg.timestamp : undefined;
        const ts =
          serverTs !== undefined
            ? prev?.ts !== undefined
              ? Math.min(prev.ts, serverTs)
              : serverTs
            : prev?.ts ?? Date.now();

        next.set(msg.clientId, {
          clientId: msg.clientId,
          name: data?.name ?? "Player",
          ts,
          modeId:
            rawModeId !== undefined
              ? resolveMatchMode(rawModeId).id
              : prev?.modeId ?? DEFAULT_MATCH_MODE_ID,
        });
      }
    }

    // Keep ourselves if snapshot raced our own presence
    if (!next.has(clientId)) {
      const existingSelf = prevMap.get(clientId);
      if (existingSelf) next.set(clientId, existingSelf);
    }

    memberMapRef.current = next;
    commitMembers(next);
  },
  [clientId, commitMembers]
);

  // Incremental presence updates
  const applyPresenceUpdate = useCallback(
    (msg: PresenceMessage | null | undefined) => {
      if (!msg?.clientId) return;
      const action = msg.action;
      const serverTs = typeof msg.timestamp === "number" ? msg.timestamp : undefined;
      const isJoin = action === "enter" || action === "present";

      const map = new Map(memberMapRef.current);
      const existing = map.get(msg.clientId);
      const data = (msg.data ?? {}) as any;

      const ts = (() => {
        if (isJoin) {
          if (serverTs !== undefined) {
            return existing?.ts !== undefined ? Math.min(existing.ts, serverTs) : serverTs;
          }
          return existing?.ts ?? Date.now();
        }
        if (existing?.ts !== undefined) return existing.ts;
        if (serverTs !== undefined) return serverTs;
        return Date.now();
      })();

      const name = data?.name ?? existing?.name ?? "Player";
      const rawModeId = typeof data?.modeId === "string" ? data.modeId : undefined;
      const memberModeId =
        rawModeId !== undefined
          ? resolveMatchMode(rawModeId).id
          : existing?.modeId ?? DEFAULT_MATCH_MODE_ID;

      if (action === "leave" || action === "absent") {
        map.delete(msg.clientId);
      } else if (action === "enter" || action === "present" || action === "update") {
        map.set(msg.clientId, { clientId: msg.clientId, name, ts, modeId: memberModeId });
      }

      memberMapRef.current = map;
      commitMembers(map);
    },
    [commitMembers]
  );

  // keep references to listeners so we can unsubscribe/cleanup precisely
  const presenceListenerRef = useRef<((...args: any[]) => void) | null>(null);
  const connectionListenerRef = useRef<((...args: any[]) => void) | null>(null);
  const startListenerRef = useRef<((...args: any[]) => void) | null>(null);
  const handoffRef = useRef(false);

  const isHost = members.length > 0 && members[0]?.clientId === clientId;

  // --- helpers ---
  function log(s: string) {
    setStatus(s);
  }

  function ensureAbly() {
    if (ablyRef.current) return ablyRef.current;
    const key = import.meta.env.VITE_ABLY_API_KEY;
    if (!key) throw new Error("Missing VITE_ABLY_API_KEY");
    const ably = new Realtime({ key, clientId });
    ablyRef.current = ably;
    return ably;
  }

  // Only A–Z without I/O (same alphabet used by makeRoomCode), max 4 chars
  function sanitizeCode(input: string) {
    const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ";
    const up = (input || "").toUpperCase();
    const out = up.split("").filter(ch => ALPHABET.includes(ch)).slice(0, 4).join("");
    return out;
  }

  // Centralized member refresh that waits for sync to avoid partial sets
  async function refreshMembers(chan: ReturnType<Realtime["channels"]["get"]>) {
    try {
      const page = await chan.presence.get({ waitForSync: true } as any);
      const list = Array.isArray(page) ? page : page?.items ?? [];
      const sorted = Array.from(list).sort(
        (a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0)
      );
      applySnapshot(sorted as any);
    } catch (e: any) {
      setStatus(`Presence get error: ${e?.message ?? e}`);
    }
  }

  // Attach channel, subscribe presence, enter presence, seed list, and wire 'start'
  async function connectRoom(rawCode: string, options: ConnectOptions = {}) {
    const code = sanitizeCode(rawCode);
    if (!code || code.length !== 4) {
      log("Invalid room code");
      return false;
    }

    const ably = ensureAbly();
    const chanName = `rw:v1:rooms:${code}`; // versioned + sanitized
    const chan = ably.channels.get(chanName);
    channelRef.current = chan;

    try {
      // 1) Ensure attached before presence ops
      await chan.attach();

      // If we're joining an existing room, verify someone else is already here
      if (options.requireExistingMembers) {
        try {
          const existing = await chan.presence.get({ waitForSync: true } as any);
          const items = Array.isArray(existing) ? existing : existing?.items ?? [];
          const others = items.filter((p) => p.clientId && p.clientId !== clientId);
          if (others.length === 0) {
            log(`Room ${code} not found. Ask the host to create it before joining.`);
            await chan.detach().catch(() => {});
            channelRef.current = null;
            return false;
          }
        } catch (err: any) {
          log(`Room lookup failed: ${err?.message ?? err}`);
          await chan.detach().catch(() => {});
          channelRef.current = null;
          return false;
        }
      }

      // 2) Subscribe to presence first (so we don't miss early events)
      memberMapRef.current = new Map();
      setMembers([]);

      const onPresence = (msg: PresenceMessage) => {
        applyPresenceUpdate(msg);
      };
      presenceListenerRef.current = onPresence;
      chan.presence.subscribe(onPresence);

// 3) Enter presence with the current name and match mode
await chan.presence.enter({ name, modeId: selectedModeId });

// Seed self immediately so the UI shows the host right away
{
  const self: MemberEntry = {
    clientId,
    name,
    ts: Date.now(),
    modeId: selectedModeId,
  };
  const map = new Map<string, MemberEntry>([[clientId, self]]);
  memberMapRef.current = map;
  commitMembers(map); // <- updates the UI list
}

// 4) Seed initial list from the server (will merge/backfill others)
await refreshMembers(chan);


      // 5) Refresh when connection state changes (covers reconnects)
      const onConn = () => {
        void refreshMembers(chan);
      };
      connectionListenerRef.current = onConn;
      ably.connection.on(onConn);

      // 6) Start event
      if (startListenerRef.current) {
        try { chan.unsubscribe("start", startListenerRef.current as any); } catch {}
        startListenerRef.current = null;
      }

      const onStartMessage = (msg: any) => {
        const payload = msg.data as StartMessagePayload;
        const localSide: Side =
          payload.players.left.id === clientId ? "left" : "right";

        try {
          if (presenceListenerRef.current) {
            chan.presence.unsubscribe(presenceListenerRef.current as any);
            presenceListenerRef.current = null;
          } else {
            chan.presence.unsubscribe();
          }
        } catch {}

        try {
          chan.unsubscribe("start", onStartMessage as any);
        } catch {}
        startListenerRef.current = null;

        if (ablyRef.current && connectionListenerRef.current) {
          try { ablyRef.current.connection.off(connectionListenerRef.current as any); } catch {}
          connectionListenerRef.current = null;
        }

        try {
          syncMultiplayerSnapshot(payload.snapshot);
        } catch (err) {
          console.error("Failed to sync multiplayer snapshot", err);
        }

        onStart({
          ...payload,
          localSide,
          channelName: chanName,
          channel: chan,
          clientId,
          ably,
        });
      };

      startListenerRef.current = onStartMessage;
      chan.subscribe("start", onStartMessage);

      // Only now, after a successful connect, set the visible room code
      setRoomCode(code);
      setMode("in-room");
      log(`Joined room ${code}`);
      return true;
    } catch (e: any) {
      log(`Room connect error: ${e?.message ?? e}`);
      try {
        if (presenceListenerRef.current) {
          chan.presence.unsubscribe(presenceListenerRef.current as any);
          presenceListenerRef.current = null;
        } else {
          chan.presence.unsubscribe();
        }
      } catch {}
      try {
        if (startListenerRef.current) {
          chan.unsubscribe("start", startListenerRef.current as any);
          startListenerRef.current = null;
        }
        chan.unsubscribe();
      } catch {}
      try { await chan.detach(); } catch {}
      if (ablyRef.current && connectionListenerRef.current) {
        try { ablyRef.current.connection.off(connectionListenerRef.current as any); } catch {}
        connectionListenerRef.current = null;
      }
      channelRef.current = null;
      memberMapRef.current = new Map();
      setMembers([]);
    }
    return false;
  }

  // If name/mode change while in-room, update presence & local cache
  useEffect(() => {
    (async () => {
      if (mode === "in-room" && channelRef.current) {
        try {
          await channelRef.current.presence.update({ name, modeId: selectedModeId });

          const current = memberMapRef.current.get(clientId);
          const map = new Map(memberMapRef.current);
          map.set(clientId, {
            clientId,
            name,
            modeId: selectedModeId,
            ts: current?.ts ?? Date.now(),
          });
          memberMapRef.current = map;
          commitMembers(map);
        } catch { /* no-op */ }
      }
    })();
  }, [clientId, commitMembers, mode, name, selectedModeId]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (handoffRef.current) return;
      try {
        const ch = channelRef.current;
        if (ch) {
          if (startListenerRef.current) {
            try { ch.unsubscribe("start", startListenerRef.current as any); } catch {}
            startListenerRef.current = null;
          }
          if (presenceListenerRef.current) ch.presence.unsubscribe(presenceListenerRef.current as any);
          else ch.presence.unsubscribe();
          ch.unsubscribe(); // remove message listeners (e.g., 'start')
          ch.presence.leave();
        }
        if (ablyRef.current && connectionListenerRef.current) {
          ablyRef.current.connection.off(connectionListenerRef.current as any);
        }
      } catch {}
    };
  }, []);

  // --- actions ---
  async function onCreateRoom() {
    const code = makeRoomCode();

    setRoomCode(code);       // show it right away
    setMode("creating");

    const created = await connectRoom(code);
    if (!created) {
      memberMapRef.current = new Map();
      setMembers([]);
      setMode("idle");
      setRoomCode("");
    }
  }

  async function onJoinRoom() {
    const code = sanitizeCode(joinCode);
    if (!code || code.length !== 4) return;
    setMode("joining");
    const joined = await connectRoom(code, { requireExistingMembers: true });
    if (!joined) {
      memberMapRef.current = new Map();
      setMembers([]);
      setMode("idle");
      setRoomCode("");
    }
  }

  async function onLeaveRoom() {
    try {
      const ch = channelRef.current;
      if (ch) {
        if (startListenerRef.current) {
          try { ch.unsubscribe("start", startListenerRef.current as any); } catch {}
          startListenerRef.current = null;
        }
        if (presenceListenerRef.current) ch.presence.unsubscribe(presenceListenerRef.current as any);
        else ch.presence.unsubscribe();
        ch.unsubscribe();
        await ch.presence.leave();
      }
      if (ablyRef.current && connectionListenerRef.current) {
        ablyRef.current.connection.off(connectionListenerRef.current as any);
      }
    } catch {}
    handoffRef.current = false;

    memberMapRef.current = new Map();

    setMembers([]);
    setMode("idle");
    setRoomCode("");
    setJoinCode("");
    setSelectedModeId(DEFAULT_MATCH_MODE_ID);
  }

  async function onStartGame() {
    if (!isHost) return;
    if (members.length < 2) {
      log("Need at least 2 players to start.");
      return;
    }

    // --- Assign sides deterministically: host=left, first joiner=right
    const players = assignSides(members);

    const winsGoal = selectedTargetWins;
    const timerSeconds = selectedTimerSeconds;
    const seed = Math.floor(Math.random() * 2 ** 31);
    const payload: StartMessagePayload = {
      roomCode,
      seed,
      players,
      hostId: members[0].clientId, // first in presence is host
      playersArr: members,         // optional, for debugging/analytics
      targetWins: winsGoal,        // 👈 pass wins goal into the game

      snapshot: getMultiplayerSnapshot(),

      modeId: selectedMode.id,
      timerSeconds,

    };

    await channelRef.current?.publish("start", payload);
    // Host will also receive the 'start' event and flow through subscribe handler
  }

  return (
    <div className="min-h-screen grid place-items-center bg-slate-950 text-slate-100 p-4">
      <div className="w-full max-w-md rounded-2xl bg-slate-900/70 p-4 ring-1 ring-white/10">
        <h1 className="text-xl font-bold mb-3">Multiplayer</h1>

        {mode === "idle" && (
          <div className="grid gap-3">
            <div className="grid gap-1">
              <label className="text-sm text-white/80">Display name</label>
              <input
                className="rounded-lg bg-black/40 px-3 py-2 ring-1 ring-white/10"
                placeholder="Your name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <button
              onClick={onCreateRoom}
              className="rounded-lg bg-amber-400 text-slate-900 font-semibold px-3 py-2"
            >
              Create Room
            </button>

            <div className="grid grid-cols-[1fr_auto] gap-2">
              <input
                className="rounded-lg bg-black/40 px-3 py-2 ring-1 ring-white/10"
                placeholder="Enter room code (e.g. ABQX)"
                value={joinCode}
                onChange={(e) => setJoinCode(sanitizeCode(e.target.value))}
                maxLength={4}
              />
              <button
                onClick={onJoinRoom}
                className="rounded-lg bg-emerald-500 text-slate-900 font-semibold px-3"
              >
                Join
              </button>
            </div>

            <button
              onClick={onBack}
              className="rounded-lg bg-white/10 px-3 py-2 ring-1 ring-white/15 hover:bg-white/15"
            >
              Back
            </button>
          </div>
        )}

        {mode !== "idle" && (
          <div className="grid gap-3">
            <div className="rounded-lg bg-black/30 px-3 py-2 ring-1 ring-white/10">
              <div className="text-sm opacity-80">Room</div>
              <div className="flex items-center justify-between">
                <div className="text-2xl font-extrabold tracking-widest">
                  {roomCode}
                </div>
                <button
                  onClick={() => { navigator.clipboard.writeText(roomCode).catch(() => {}); }}
                  className="rounded bg-white/10 px-2 py-1 text-sm hover:bg-white/15"
                >
                  Copy
                </button>
              </div>
            </div>

            <div className="rounded-lg bg-black/30 px-3 py-2 ring-1 ring-white/10">
              <div className="mb-1 flex items-center justify-between text-sm opacity-80">
                <span>Match mode</span>
                {!isHost && (
                  <span className="rounded bg-white/10 px-2 py-0.5 text-xs">Host controls this</span>
                )}
              </div>
              <div className="grid gap-2">
                {modeOptions.map((mode) => {
                  const isSelected = selectedModeId === mode.id;
                  const timerLabel = formatModeTimer(mode.timerSeconds);
                  return (
                    <label
                      key={mode.id}
                      className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-left transition ${
                        isSelected ? "border-amber-400/80 bg-amber-400/10" : "border-white/10 bg-black/30 hover:border-white/20"
                      } ${!isHost ? "cursor-default opacity-90" : ""}`}
                    >
                      <input
                        type="radio"
                        name="match-mode"
                        className="mt-1"
                        checked={isSelected}
                        onChange={() => {
                          if (!isHost) return;
                          setSelectedModeId(mode.id);
                        }}
                        disabled={!isHost}
                      />
                      <div className="flex flex-col gap-0.5">
                        <div className="text-sm font-semibold text-white">
                          {mode.name}
                        </div>
                        <div className="text-xs text-white/80">
                          {mode.targetWins} wins · {timerLabel}
                        </div>
                        <div className="text-[11px] text-white/60">{mode.description}</div>
                      </div>
                    </label>
                  );
                })}
              </div>
              <div className="mt-1 text-xs opacity-70">
                Selected: {selectedMode.name} — first to {selectedTargetWins} wins
                {selectedTimerSeconds ? ` with a ${formatModeTimer(selectedTimerSeconds)} timer.` : " with no timer."}
              </div>
            </div>

            <div className="rounded-lg bg-black/30 px-3 py-2 ring-1 ring-white/10">
              <div className="text-sm opacity-80 mb-1">Players</div>
              <ul className="text-sm grid gap-1">
                {members.map((m, i) => (
                  <li key={m.clientId} className="flex items-center justify-between">
                    <span>
                      {i === 0 ? "👑 " : "👤 "}
                      {m.name}{" "}
                      <span className="opacity-60 text-xs">({m.clientId.slice(0, 4)})</span>
                    </span>
                    {m.clientId === clientId && (
                      <span className="rounded bg-white/10 px-2 py-0.5 text-xs">You</span>
                    )}
                  </li>
                ))}
              </ul>
              <div className="mt-2 text-xs opacity-70">
                Host is the first to join. When 2+ players are here, host can start.
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={onLeaveRoom}
                className="rounded-lg bg-white/10 px-3 py-2 ring-1 ring-white/15 hover:bg-white/15"
              >
                Leave
              </button>
              <button
                onClick={onStartGame}
                disabled={!isHost || members.length < 2}
                className="ml-auto rounded-lg bg-amber-400 text-slate-900 font-semibold px-3 py-2 disabled:opacity-50"
              >
                Start Game {isHost ? "" : "(Host only)"}
              </button>
            </div>

            {status && (
              <div className="text-xs opacity-70 pt-1 border-t border-white/10">
                {status}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// --- helpers ---
function makeRoomCode() {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ"; // no I/O to avoid confusion
  let s = "";
  for (let i = 0; i < 4; i++) {
    s += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return s;
}

function uid4() {
  // short client id
  return Math.random().toString(36).slice(2, 6) + Math.random().toString(36).slice(2, 6);
}

function defaultName() {
  const animals = ["Fox", "Bear", "Lynx", "Hawk", "Otter", "Wolf", "Drake"];
  return `Player ${animals[Math.floor(Math.random() * animals.length)]}`;
}

function formatModeTimer(seconds: number | null | undefined): string {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) {
    return "No timer";
  }
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  if (minutes > 0) {
    return `${minutes}:${secs.toString().padStart(2, "0")}`;
  }
  return `${secs}s`;
}

// Assign sides from presence order (host=left, first joiner=right)
function assignSides(members: { clientId: string; name: string }[]): Players {
  // Ensure deterministic order (you already sort by presence timestamp above)
  const left = members[0];
  const right = members[1];

  return {
    left:  { id: left.clientId,  name: left.name,  color: "#22c55e" },
    right: { id: right.clientId, name: right.name, color: "#f97316" },
  };
}
