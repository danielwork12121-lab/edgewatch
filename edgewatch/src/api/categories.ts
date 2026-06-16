export interface Category {
  id: string
  label: string
  tag: string | null  // Polymarket Gamma API tag parameter (null = trending)
  emoji: string
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
