export type CardId = string;

export type InventoryItem = { cardId: CardId; qty: number };
export type DeckCard = { cardId: CardId; qty: number };
export type Deck = { id: string; name: string; isActive: boolean; cards: DeckCard[] };

export type Profile = {
  id: string;
  displayName: string;
  avatarUrl?: string;
  mmr: number;
  createdAt: number;
};

export type LocalState = {
  version: number;
  profile: Profile;
  inventory: InventoryItem[];
  decks: Deck[];
};
