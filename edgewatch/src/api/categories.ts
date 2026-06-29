export interface Category {
  id: string
  label: string
  tag: string | null  // Polymarket Gamma API tag parameter (null = trending)
  emoji: string
}

export const CATEGORY_KEYWORDS: Record<string, string[]> = {
  crypto: [
    'bitcoin', 'btc', 'ethereum', 'eth', 'solana', 'crypto', 'blockchain',
    'token', 'coin', 'xrp', 'doge', 'binance', 'stablecoin', 'defi',
  ],
  politics: [
    'election', 'president', 'senate', 'congress', 'trump', 'biden',
    'democrat', 'republican', 'governor', 'minister', 'government', 'policy',
    'vote', 'polling', 'supreme court', 'geopolitics',
  ],
  sports: [
    'football', 'soccer', 'nba', 'nfl', 'mlb', 'nhl', 'ufc', 'tennis',
    'fifa', 'world cup', 'f1', 'formula', 'champions league', 'olympics',
    'player', 'team', 'match',
  ],
  entertainment: [
    'movie', 'film', 'box office', 'music', 'album', 'song', 'celebrity',
    'tv', 'netflix', 'oscar', 'grammy', 'anime', 'manga', 'game', 'gaming',
    'streamer', 'youtube',
  ],
  science: [
    'space', 'nasa', 'climate', 'ai', 'science', 'medicine', 'disease',
    'vaccine', 'earthquake', 'weather', 'temperature', 'research', 'asteroid',
    'launch', 'energy',
  ],
}

export const CATEGORIES: Category[] = [
  { id: 'trending',      label: 'Trending',       tag: null,            emoji: '🔥' },
  { id: 'crypto',        label: 'Crypto',          tag: 'crypto',        emoji: '₿'  },
  { id: 'politics',      label: 'Politics',        tag: 'politics',      emoji: '🗳️' },
  { id: 'sports',        label: 'Sports',          tag: 'sports',        emoji: '⚽' },
  { id: 'entertainment', label: 'Entertainment',   tag: 'entertainment', emoji: '🎬' },
  { id: 'science',       label: 'Science',         tag: 'science',       emoji: '🔬' },
]

export function getCategoryById(id: string): Category | undefined {
  return CATEGORIES.find(c => c.id === id)
}

export function getCategoryKeywords(categoryId: string): string[] {
  return CATEGORY_KEYWORDS[categoryId] ?? []
}
