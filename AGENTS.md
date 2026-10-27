# Ginkgo 美食地图 V2 开发规则

## 技术基线

- Java 21
- Spring Boot 4.0.x
- Maven 3.9+
- MySQL 8.4
- Redis
- Flyway
- Spring Security
- JUnit 5
- Vue 3 + TypeScript + Vite
- Nginx

## 架构规则

- 当前形态是模块化单体，最终生成一个可执行 JAR。
- 顶层包按业务领域划分，不建立全局 controller、service、repository、entity 目录。
- 每个业务模块只能直接访问自己的 Repository 和数据表。
- 跨模块调用必须通过公开的应用服务接口或领域事件。
- `common` 只存放真正通用的技术能力，禁止放业务逻辑。
- Controller 只处理协议转换、参数校验和响应，不编写核心业务逻辑。
- Entity 不直接作为 API 请求或响应对象。
- 所有数据库结构变化必须通过 Flyway 迁移文件完成。
- 所有权限判断必须在服务端完成，不能只依赖前端按钮是否显示。

## 安全规则

- 不提交密码、令牌、地图密钥或生产配置。
- 日志不得输出密码、令牌和完整敏感数据。
- 修改接口默认需要认证；公开接口必须显式列入安全配置。
- 用户只能修改自己的资源，管理员能力必须单独授权。

## 验证命令

```powershell
cd backend
mvn test
mvn verify

cd ../frontend
npm run typecheck
npm run lint
npm run build
npm test
```

## 协作开发约定

- 每次只完成一个便于审核的最小修改步骤；完成后说明变更内容，等待审核再继续。
- 每个新功能遵循标准开发流程，从基线分支新建独立的功能分支，完成验证和审核后再合并。
- 设计和实现必须保持清晰的模块边界，避免跨模块直接依赖，为以后拆分微服务做好准备。
- 持续维护 `docs/development.md`，每次修改都记录变更内容和验证结果；文件过长时依次新建 `development2.md`、`development3.md`。

## 完成标准

- 需求和验收条件明确。
- 实现符合模块边界。
- 输入校验、异常路径和权限校验完整。
- 单元测试或集成测试覆盖主要行为。
- 数据库迁移可重复执行。
- 文档与代码同步更新。
- 构建和测试通过后才算完成。
