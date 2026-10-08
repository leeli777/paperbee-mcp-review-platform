# PaperBee 备份与恢复

## 发布前备份

在有 Cloudflare 运维权限的机器上，先构建，确保读取现有生产绑定：

```sh
npm run build
npm run backup -- create backups/2026-09-22-before-release
npm run backup -- verify backups/2026-09-22-before-release
npm run backup -- restore-local backups/2026-09-22-before-release backups/2026-09-22-restored.sqlite
```

`create` 只读取线上数据：导出 D1 SQL，按 project_versions 下载每份材料，再次导出数据库，确认材料清单未变化。仅清单稳定且文件大小匹配时写入完成清单。`verify` 核对 SQL 和全部材料的 SHA-256、SQLite integrity_check、外键及材料引用。`restore-local` 导入到新的本地 SQLite 文件，拒绝覆盖已有文件，不连接线上。

输出包括 `database.sql`、`manifest.json` 和 `artifacts/`。材料文件名按存储键哈希生成，原存储键映射保存在清单。只备份数据库引用的材料，不保留对象存储中已失去引用的孤立文件；应用不依赖 KV metadata 恢复读取功能。

备份含密码哈希、成员资料及科研材料，按敏感数据管理：目录权限 0700，文件 0600，`backups/` 被 Git 忽略。不要放到 public、部署包或 Git 仓库中。副本应保存在组织认可的加密磁盘或受限存储；本工具没有配置外部副本或定时任务。建议每日备份，保留最近 7 份日备份和 4 份周备份；先验证新副本再人工清理旧副本，不自动删除任何材料。

数据库导出与 KV 读取不是跨服务原子快照。材料存储键由上传流程唯一生成且不可覆盖，前后清单检查可检测上传/删除变化；发生变化应换新目录重试。若连续变化，在低流量时段或维护窗口重试。失败目录没有有效清单，不能当作可恢复备份。

## 故障恢复流程

1. 先停止写入并保留当前现场，明确恢复时间点与可能丢失的后续修改。
2. 在独立测试数据库和材料命名空间恢复经过 verify 的副本；本工具只自动执行本地数据库恢复，生产恢复必须显式指定目标。
3. 按 manifest 中的原始 key 恢复二进制材料，核验全部引用和文件校验值。不要把 SQL 中的 key 改成哈希文件名。
4. 在隔离环境启动应用，检查作者/他人/管理员权限、材料下载、私有项目、审稿任务和报告。恢复上线前撤销备份中旧会话、上传授权和 OAuth 凭据，避免重新激活已经撤销的登录。
5. 验证后再切换生产绑定，记录切换及回退方式。禁止直接拿生产数据库演练恢复。

代码回退和数据恢复是两件事。本次版本没有数据库结构迁移，可用发布前记录的 Worker 版本回滚代码，但这不会回滚数据。

## 官方参考

- [D1 导入与导出](https://developers.cloudflare.com/d1/best-practices/import-export-data/)
- [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)
- [KV 运维命令](https://developers.cloudflare.com/workers/wrangler/commands/kv/)
