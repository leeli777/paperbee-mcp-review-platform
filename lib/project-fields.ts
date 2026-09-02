export const PROJECT_FIELDS = [
  "理论物理",
  "粒子与核物理",
  "凝聚态物理",
  "天体物理",
  "量子信息",
  "交叉学科",
  "其他",
] as const;

export function isProjectField(value: string) {
  return PROJECT_FIELDS.some((field) => field === value);
}
