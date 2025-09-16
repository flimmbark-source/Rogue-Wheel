import * as Ably from 'ably';

export const ably = new Ably.Realtime({
  key: import.meta.env.VITE_ABLY_API_KEY,
});

export function getChannel(roomId: string) {
  return ably.channels.get(`room:${roomId}`);
}
