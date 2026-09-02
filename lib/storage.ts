import { env } from "cloudflare:workers";

type StoredArtifact = {
  body: ArrayBuffer;
  size: number;
};

type ArtifactStore = {
  put(
    key: string,
    value: ArrayBuffer,
    metadata?: Record<string, string>,
  ): Promise<unknown>;
  get(key: string): Promise<StoredArtifact | null>;
  delete(key: string): Promise<void>;
};

type ArtifactMetadata = Record<string, string>;

export function getArtifactStore(): ArtifactStore {
  const namespace = (env as unknown as { ARTIFACTS?: KVNamespace }).ARTIFACTS;
  if (!namespace) throw new Error("私有文件存储尚未配置");

  return {
    put: (key, value, metadata) => namespace.put(key, value, { metadata }),
    async get(key) {
      const result = await namespace.getWithMetadata<ArtifactMetadata>(key, "arrayBuffer");
      if (!result.value) return null;
      return { body: result.value, size: result.value.byteLength };
    },
    delete: (key) => namespace.delete(key),
  };
}
