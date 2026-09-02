import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { members, uploadTokens } from "@/db/schema";
import { AccessError } from "@/lib/auth";
import { hashSessionToken } from "@/lib/credentials";

export const UPLOAD_TOKEN_LIFETIME_MINUTES = 60;

export type UploadTokenErrorCode =
  | "TOKEN_MISSING"
  | "TOKEN_INVALID"
  | "TOKEN_EXPIRED"
  | "TOKEN_REVOKED"
  | "ACCOUNT_INACTIVE";

export class UploadTokenError extends AccessError {
  constructor(
    message: string,
    public code: UploadTokenErrorCode,
    status = 401,
  ) {
    super(message, status);
  }
}

export async function requireUploadToken(request: Request) {
  const authorization = request.headers.get("Authorization") ?? "";
  const match = authorization.match(/^Bearer\s+(pb_upload_[A-Za-z0-9_-]+)$/i);
  if (!match) throw new UploadTokenError("缺少有效的上传密钥", "TOKEN_MISSING");

  const db = await getDb();
  const tokenHash = await hashSessionToken(match[1]);
  const now = new Date();
  const oldestValidCreation = new Date(
    now.getTime() - UPLOAD_TOKEN_LIFETIME_MINUTES * 60 * 1000,
  ).toISOString();
  const [record] = await db
    .select({
      tokenId: uploadTokens.id,
      memberId: members.id,
      memberName: members.name,
      memberStatus: members.status,
      createdAt: uploadTokens.createdAt,
      expiresAt: uploadTokens.expiresAt,
      revokedAt: uploadTokens.revokedAt,
    })
    .from(uploadTokens)
    .innerJoin(members, eq(uploadTokens.memberId, members.id))
    .where(eq(uploadTokens.tokenHash, tokenHash))
    .limit(1);
  if (!record) throw new UploadTokenError("上传密钥无效", "TOKEN_INVALID");
  if (record.revokedAt) throw new UploadTokenError("上传密钥已撤销或已使用", "TOKEN_REVOKED");
  if (record.createdAt <= oldestValidCreation || record.expiresAt <= now.toISOString()) {
    throw new UploadTokenError("上传密钥已过期，请重新复制 AI 上传提示词", "TOKEN_EXPIRED");
  }
  if (record.memberStatus !== "active") {
    throw new UploadTokenError("PaperBee 账号已停用", "ACCOUNT_INACTIVE", 403);
  }

  await db
    .update(uploadTokens)
    .set({ lastUsedAt: now.toISOString() })
    .where(eq(uploadTokens.id, record.tokenId));
  return record;
}

export async function consumeUploadToken(tokenId: string) {
  const db = await getDb();
  await db
    .update(uploadTokens)
    .set({ revokedAt: new Date().toISOString() })
    .where(and(eq(uploadTokens.id, tokenId), isNull(uploadTokens.revokedAt)));
}
