import React, { useEffect, useMemo, useRef, useState } from "react";
import { Realtime } from "ably";
import type { Players, Side } from "./game/types";

// ----- Start payload now includes a Players map and localSide -----
type StartMessagePayload = {
  roomCode: string;
  seed: number;
  hostId: string;
  players: Players;          // { left: {id,name,color}, right: {…} }
  playersArr?: { clientId: string; name: string }[]; // optional: raw list for debugging
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

  // ---- Ably core refs ----
  const ablyRef = useRef<Realtime | null>(null);
  const channelRef = useRef<ReturnType<Realtime["channels"]["get"]> | null>(null);
  const [members, setMembers] = useState<{ clientId: string; name: string }[]>([]);
  const clientId = useMemo(() => uid4(), []);

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
      const list = await chan.presence.get({ waitForSync: true } as any);
      const mapped =
        list
          ?.sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0))
          .map((p) => ({
            clientId: p.clientId!,
            name: (p.data as any)?.name ?? "Player",
          })) ?? [];
      setMembers(mapped);
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
          const others = existing?.filter((p) => p.clientId && p.clientId !== clientId) ?? [];
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
      const onPresence = () => {
        void refreshMembers(chan);
      };
      presenceListenerRef.current = onPresence;
      chan.presence.subscribe(onPresence);

      // 3) Enter presence with the current name
      await chan.presence.enter({ name });

      // 4) Seed initial list
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

        handoffRef.current = true;

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
    }
    return false;
  }

  // Optional: if the user edits their name while in-room, update presence
  useEffect(() => {
    (async () => {
      if (mode === "in-room" && channelRef.current) {
        try {
          await channelRef.current.presence.update({ name });
          await refreshMembers(channelRef.current);
        } catch { /* no-op */ }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);

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

  setRoomCode(code);       // ✅ show it right away
  setMode("creating");     // UI shows the Room box with the code

  const created = await connectRoom(code);
  if (!created) {
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
    setMembers([]);
    setMode("idle");
    setRoomCode("");
    setJoinCode("");
  }

  async function onStartGame() {
    if (!isHost) return;
    if (members.length < 2) {
      log("Need at least 2 players to start.");
      return;
    }

    // --- Assign sides deterministically: host=left, first joiner=right
    const players = assignSides(members);

    const seed = Math.floor(Math.random() * 2 ** 31);
    const payload: StartMessagePayload = {
      roomCode,
      seed,
      players,
      hostId: members[0].clientId, // first in presence is host
      playersArr: members,         // optional, for debugging/analytics
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

// Assign sides from presence order (host=left, first joiner=right)
function assignSides(members: { clientId: string; name: string }[]): Players {
  // Ensure deterministic order (you already sort by presence timestamp above)
  const left = members[0];
  const right = members[1];

  // Side colors: left green, right orange (feel free to theme later)
  return {
    left:  { id: left.clientId,  name: left.name,  color: "#22c55e" },
    right: { id: right.clientId, name: right.name, color: "#f97316" },
  };
}
