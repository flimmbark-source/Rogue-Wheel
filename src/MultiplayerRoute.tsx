import React, { useEffect, useMemo, useRef, useState } from "react";
import { Realtime } from "ably";

type StartPayload = {
  roomCode: string;
  seed: number;
  players: { clientId: string; name: string }[];
  hostId: string;
};

export default function MultiplayerRoute({
  onBack,
  onStart,
}: {
  onBack: () => void;
  onStart: (payload: StartPayload) => void;
}) {
  // ---- UI state ----
  const [mode, setMode] = useState<"idle" | "creating" | "joining" | "in-room">(
    "idle"
  );
  const [roomCode, setRoomCode] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [name, setName] = useState<string>(() => defaultName());
  const [status, setStatus] = useState<string>("");

  // ---- Ably core refs ----
  const ablyRef = useRef<Realtime | null>(null);
  const channelRef = useRef<ReturnType<Realtime["channels"]["get"]> | null>(
    null
  );
  const [members, setMembers] = useState<{ clientId: string; name: string }[]>(
    []
  );
  const clientId = useMemo(() => uid4(), []);

  const isHost = members.length > 0 && members[0]?.clientId === clientId;

  // --- helpers ---
  function log(s: string) {
    setStatus(s);
    // console.log(s); // keep if you want
  }

  // Create Ably client lazily
  function ensureAbly() {
    if (ablyRef.current) return ablyRef.current;
    const key = import.meta.env.VITE_ABLY_API_KEY;
    if (!key) {
      throw new Error("Missing VITE_ABLY_API_KEY");
    }
    const ably = new Realtime({ key, clientId });
    ablyRef.current = ably;
    return ably;
  }

  function connectRoom(code: string) {
    const ably = ensureAbly();
    const chan = ably.channels.get(`rw-rooms:${code.toUpperCase()}`);
    channelRef.current = chan;

    // presence updates
    chan.presence.subscribe(async () => {
      const list = await chan.presence.get();
      const mapped =
        list
          ?.sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0))
          .map((p) => ({
            clientId: p.clientId!,
            name: (p.data as any)?.name ?? "Player",
          })) ?? [];
      setMembers(mapped);
    });

    // start event
    chan.subscribe("start", (msg) => {
      const payload = msg.data as StartPayload;
      onStart(payload);
    });

    // Enter presence
    chan.presence
      .enter({ name })
      .then(() => {
        setMode("in-room");
        log(`Joined room ${code}`);
      })
      .catch((e) => log(`Presence error: ${e?.message ?? e}`));
  }

  // Cleanup on unmount or leaving room
  useEffect(() => {
    return () => {
      try {
        const ch = channelRef.current;
        ch?.presence?.leave();
        if (ablyRef.current) {
          // Let Ably close when no channels (optional)
          // ablyRef.current.close();
        }
      } catch {}
    };
  }, []);

  // --- actions ---
  function onCreateRoom() {
    const code = makeRoomCode();
    setRoomCode(code);
    setMode("creating");
    connectRoom(code);
  }

  function onJoinRoom() {
    if (!joinCode.trim()) return;
    const code = joinCode.trim().toUpperCase();
    setRoomCode(code);
    setMode("joining");
    connectRoom(code);
  }

  async function onLeaveRoom() {
    try {
      await channelRef.current?.presence.leave();
    } catch {}
    setMembers([]);
    setMode("idle");
    setRoomCode("");
    setJoinCode("");
  }

  async function onStartGame() {
    if (!isHost) return;
    const seed = Math.floor(Math.random() * 2 ** 31);
    const payload: StartPayload = {
      roomCode,
      seed,
      players: members,
      hostId: clientId,
    };
    await channelRef.current?.publish("start", payload);
    // Host’s client will also receive the 'start' and call onStart
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
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
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
                  onClick={() => {
                    navigator.clipboard.writeText(roomCode).catch(() => {});
                  }}
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
                  <li
                    key={m.clientId}
                    className="flex items-center justify-between"
                  >
                    <span>
                      {i === 0 ? "👑 " : "👤 "}
                      {m.name}{" "}
                      <span className="opacity-60 text-xs">
                        ({m.clientId.slice(0, 4)})
                      </span>
                    </span>
                    {m.clientId === clientId && (
                      <span className="rounded bg-white/10 px-2 py-0.5 text-xs">
                        You
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              <div className="mt-2 text-xs opacity-70">
                Host is the first to join. When 2+ players are here, host can
                start.
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
