import { loadState, saveState } from "./singleStore";
import type { Deck, DeckCard, InventoryItem, LocalState } from "../types/profile";

const MAX_DECK_SIZE = 10;
const MAX_COPIES_PER_DECK = 2;

const findActive = (s: LocalState) => s.decks.find((d) => d.isActive) ?? s.decks[0];
const sum = (cards: DeckCard[]) => cards.reduce((a, c) => a + c.qty, 0);
const qtyInDeck = (d: Deck, id: string) => d.cards.find((c) => c.cardId === id)?.qty ?? 0;
const setQty = (d: Deck, id: string, q: number) => {
  const i = d.cards.findIndex((c) => c.cardId === id);
  if (q <= 0) {
    if (i >= 0) d.cards.splice(i, 1);
    return;
  }
  if (i >= 0) d.cards[i].qty = q;
  else d.cards.push({ cardId: id, qty: q });
};
const ownAtLeast = (inv: InventoryItem[], id: string, need: number) => (inv.find((i) => i.cardId === id)?.qty ?? 0) >= need;

export function getProfileBundle() {
  const s = loadState();
  return { profile: s.profile, inventory: s.inventory, decks: s.decks, active: findActive(s) };
}

export function createDeck(name = "New Deck") {
  const s = loadState();
  const d: Deck = {
    id: crypto.randomUUID?.() ?? Math.random().toString(36).slice(2),
    name,
    isActive: false,
    cards: [],
  };
  s.decks.push(d);
  saveState(s);
  return d;
}
export function setActiveDeck(id: string) {
  const s = loadState();
  s.decks = s.decks.map((d) => ({ ...d, isActive: d.id === id }));
  saveState(s);
}
export function renameDeck(id: string, name: string) {
  const s = loadState();
  const d = s.decks.find((x) => x.id === id);
  if (d) d.name = name || "Deck";
  saveState(s);
}
export function deleteDeck(id: string) {
  const s = loadState();
  s.decks = s.decks.filter((d) => d.id !== id);
  if (!s.decks.some((d) => d.isActive) && s.decks[0]) s.decks[0].isActive = true;
  saveState(s);
}

export type SwapItem = { cardId: string; qty: number };

export function swapDeckCards(deckId: string, remove: SwapItem[], add: SwapItem[]) {
  const s = loadState();
  const deck = s.decks.find((d) => d.id === deckId);
  if (!deck) throw new Error("Deck not found");

  const next: DeckCard[] = deck.cards.map((c) => ({ ...c }));
  const tmp: Deck = { ...deck, cards: next };

  for (const r of remove) {
    setQty(tmp, r.cardId, Math.max(0, qtyInDeck(tmp, r.cardId) - r.qty));
  }
  for (const a of add) {
    setQty(tmp, a.cardId, qtyInDeck(tmp, a.cardId) + a.qty);
  }

  if (sum(tmp.cards) > MAX_DECK_SIZE) throw new Error(`Deck too large (max ${MAX_DECK_SIZE})`);
  for (const c of tmp.cards) {
    if (!c.cardId.startsWith("basic_") && c.qty > MAX_COPIES_PER_DECK)
      throw new Error(`Too many copies of ${c.cardId} (max ${MAX_COPIES_PER_DECK})`);
    if (!ownAtLeast(s.inventory, c.cardId, 1)) throw new Error(`You don't own ${c.cardId}`);
  }

  deck.cards = tmp.cards;
  saveState(s);
  return deck;
}

export function addToInventory(items: SwapItem[]) {
  const s = loadState();
  for (const it of items) {
    const i = s.inventory.findIndex((x) => x.cardId === it.cardId);
    if (i >= 0) s.inventory[i].qty += it.qty;
    else s.inventory.push({ cardId: it.cardId, qty: it.qty });
  }
  saveState(s);
}
