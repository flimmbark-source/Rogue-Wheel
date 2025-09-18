import { useCallback, useEffect, useRef, useState } from "react";
import { Realtime } from "ably";

type AblyRealtime = InstanceType<typeof Realtime>;
type AblyChannel = ReturnType<AblyRealtime["channels"]["get"]>;

type MultiplayerStatus = "idle" | "connecting" | "ready" | "error";

type UseMultiplayerChannelArgs<TIntent> = {
  roomCode?: string | null;
  clientId?: string;
  onIntent: (intent: TIntent) => void;
};

type UseMultiplayerChannelResult<TIntent> = {
  sendIntent: (intent: TIntent) => void;
  status: MultiplayerStatus;
};

function useMultiplayerChannel<TIntent>({
  roomCode,
  clientId,
  onIntent,
}: UseMultiplayerChannelArgs<TIntent>): UseMultiplayerChannelResult<TIntent> {
  const onIntentRef = useRef(onIntent);
  const ablyRef = useRef<AblyRealtime | null>(null);
  const chanRef = useRef<AblyChannel | null>(null);
  const [status, setStatus] = useState<MultiplayerStatus>("idle");

  useEffect(() => {
    onIntentRef.current = onIntent;
  }, [onIntent]);

  useEffect(() => {
    if (!roomCode) {
      try {
        chanRef.current?.unsubscribe();
      } catch {}
      try {
        chanRef.current?.detach();
      } catch {}
      chanRef.current = null;
      if (ablyRef.current) {
        try {
          ablyRef.current.close();
        } catch {}
        ablyRef.current = null;
      }
      setStatus("idle");
      return;
    }

    const key = import.meta.env.VITE_ABLY_API_KEY;
    if (!key) {
      setStatus("error");
      return;
    }

    setStatus("connecting");

    const ably = new Realtime({ key, clientId });
    ablyRef.current = ably;

    const channel = ably.channels.get(`rw:v1:rooms:${roomCode}`);
    chanRef.current = channel;

    let activeSub = true;

    (async () => {
      try {
        await channel.attach();
        if (!activeSub) return;
        setStatus("ready");
        channel.subscribe("intent", (msg) => {
          if (!activeSub) return;
          const intent = msg?.data as TIntent;
          onIntentRef.current(intent);
        });
      } catch {
        if (!activeSub) return;
        setStatus("error");
      }
    })();

    return () => {
      activeSub = false;
      try {
        channel.unsubscribe();
      } catch {}
      try {
        channel.detach();
      } catch {}
      try {
        ably.close();
      } catch {}
      if (chanRef.current === channel) {
        chanRef.current = null;
      }
      if (ablyRef.current === ably) {
        ablyRef.current = null;
      }
      setStatus((prev) => (prev === "error" ? prev : "idle"));
    };
  }, [roomCode, clientId]);

  const sendIntent = useCallback((intent: TIntent) => {
    try {
      void chanRef.current?.publish("intent", intent);
    } catch {}
  }, []);

  return { sendIntent, status };
}

export default useMultiplayerChannel;
