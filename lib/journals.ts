export const JOURNAL_OPTIONS = [
  "PRL",
  "PRD",
  "PRC",
  "PRA",
  "PRX",
  "EPJC",
  "CPC",
  "JHEP",
  "其他",
] as const;

export function isJournalOption(value: string) {
  return JOURNAL_OPTIONS.some((journal) => journal === value);
}
