export const MAX_TAGS_PER_PROJECT = 20;
export const MAX_TAG_LENGTH = 24;

export function cleanTagName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function normalizeTagName(value: string) {
  return cleanTagName(value).toLocaleLowerCase("zh-CN");
}

export function isValidTagName(value: string) {
  const clean = cleanTagName(value);
  return clean.length >= 1 && clean.length <= MAX_TAG_LENGTH && !/[<>]/.test(clean);
}
