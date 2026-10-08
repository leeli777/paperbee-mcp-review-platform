import { AccessError } from "@/lib/auth";
import { isProjectField } from "@/lib/project-fields";

export const PROJECT_PAGE_SIZE = 24;

export function parseProjectList(url: string) {
  const params = new URL(url).searchParams;
  const rawPage = params.get("page") ?? "1";
  const page = Number(rawPage);
  const scope = params.get("scope") ?? "all";
  const field = params.get("field") ?? "";
  const search = (params.get("q") ?? "").trim();
  if (!/^\d+$/.test(rawPage) || !Number.isSafeInteger(page) || page < 1 || page > 1_000_000) {
    throw new AccessError("无效的页码", 400);
  }
  if (!["all", "shared", "mine"].includes(scope)) throw new AccessError("无效的项目范围", 400);
  if (field && !isProjectField(field)) throw new AccessError("无效的研究领域", 400);
  if (search.length > 200) throw new AccessError("搜索内容不能超过 200 个字符", 400);
  return { page, scope, field, search };
}
