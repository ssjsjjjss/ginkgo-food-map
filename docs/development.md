# Development Log

本文档按时间记录项目的重要开发变更、验证结果和后续工作。内容过长时，后续日志依次写入 `development2.md`、`development3.md`。

## 2026-10-27：建立 V2 模块化单体重构基线

### 开发分支

- 当前分支：`refactor`
- 基线分支：`develop`
- 上游仓库：`https://github.com/ssjsjjjss/ginkgo-food-map.git`

### 变更目的

将原有 Node.js 与静态前端混合项目重构为职责清晰的前后端分离项目。在服务器资源有限的前提下，后端先采用模块化单体，并通过明确的模块边界为以后拆分微服务做准备。

### 当前技术架构

- 后端：Java 21、Spring Boot 4、Spring Security、Spring Data JPA、Flyway。
- 数据存储：MySQL 8.4、Redis。
- 前端：Vue 3、TypeScript、Vite、Vue Router、Pinia、Axios。
- 部署：Nginx 托管前端静态资源并反向代理后端接口。

### 目录与职责调整

- 新建 `backend`，按 `user`、`restaurant`、`review`、`admin`、`file`、`security`、`system` 和 `common` 划分模块。
- 新建 `frontend`，按 `app`、`pages`、`modules` 和 `shared` 划分职责。
- 新增 Flyway 数据库迁移基础配置。
- 新增 MySQL、Redis 和前端的容器编排配置。
- 移除原项目中混合存放的构建产物、旧静态资源、旧 Node.js 服务及旧测试脚本。
- 补充模块化单体、前端架构和旧版本迁移说明。

### 架构约束

- 每个业务模块只访问自己拥有的数据和 Repository。
- 跨模块协作通过公开服务接口或领域事件完成。
- `common` 只存放通用技术能力，不承载业务逻辑。
- 数据库结构只通过 Flyway 迁移脚本修改。
- 权限判断必须由服务端完成。

### 已完成验证

- 后端执行 `mvn test` 成功。
- 测试结果：2 个测试通过，0 个失败，0 个错误。
- 前端此前执行 `npm run check` 成功，包含 ESLint、Vitest、类型检查和生产构建。
- Docker Compose 配置解析通过；尚未执行完整容器启动验证。

### 当前环境状态

- MySQL 地址：`localhost:3306`，本地开发账户通过环境变量提供。
- Redis 使用数据库 `4`，无密码；检查时 Redis 服务尚未启动。
- SMTP、JWT RSA 密钥和验证码 HMAC 密钥尚未配置。
- 敏感凭据不得写入 Git 仓库。

### 后续工作

1. 审核并提交当前 V2 重构基线。
2. 将 `refactor` 推送到远程并通过 Pull Request 合并到 `develop`。
3. 从更新后的 `develop` 创建 `feature/user-auth`。
4. 分阶段实现用户注册、登录、JWT、Redis 会话、退出登录和密码重置。

## 2026-10-27：移除 Docker MySQL 硬编码凭据

### 变更内容

- `compose.yaml` 不再保存固定的 MySQL 数据库名、用户和密码。
- Docker MySQL 配置统一从 `MYSQL_DATABASE`、`MYSQL_USER`、`MYSQL_PASSWORD` 和 `MYSQL_ROOT_PASSWORD` 环境变量读取。
- `.env.example` 增加对应的非敏感示例配置，真实密码继续由未纳入版本控制的本地 `.env` 提供。

### 验证结果

- 执行 `docker compose --env-file .env.example config --quiet` 成功。

## 2026-10-27：重构分支提交前清理

### 变更内容

- 清理 `.gitignore` 和根目录 `README.md` 的多余文件尾空行。
- 对 V2 重构内容执行提交前完整检查，检查通过后提交并推送至 `refactor` 分支。

### 验证结果

- 后端执行 `mvn verify` 成功：2 个测试通过，0 个失败，0 个错误。
- 前端执行 `npm run check` 成功：ESLint、Vitest、类型检查和生产构建全部通过。
- 执行 `docker compose --env-file .env.example config --quiet` 成功。
- 执行 `git diff --check` 未发现空白错误。
