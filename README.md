# Ginkgo 美食地图 V2

V2 是对旧版 Ginkgo 美食地图的渐进式重构。第一阶段采用模块化单体：业务代码按领域分开，运行时仍是一个 Spring Boot 进程，数据使用 MySQL，缓存与会话基础设施使用 Redis。

## 当前阶段

- 已建立 Java 21 + Spring Boot 4.0 的后端骨架
- 已建立 Vue 3 + TypeScript + Vite 前端，并由 Nginx 承担静态部署和 API 反向代理
- 已按用户、餐厅、评价、管理、文件和安全领域划分包
- 已接入 MySQL、Redis、Flyway、JPA、Spring Security 和 Actuator
- 已提供 MySQL 与 Redis 的 Compose 配置
- 暂未迁移旧系统业务和数据

## 目录

```text
ginkgo-food-map-v2/
├── backend/                 Spring Boot 模块化单体
├── frontend/                Vue 3 前端与 Nginx 部署配置
├── docs/                    产品、架构和迁移文档
├── compose.yaml             本地 MySQL 与 Redis
└── AGENTS.md                AI 和开发协作规则
```

## 本地启动

前置条件：Java 21、Maven 3.9，以及已经运行的 MySQL 8 和 Redis；也可以使用 Docker Compose 启动它们。

```powershell
docker compose up -d mysql redis
cd backend
mvn spring-boot:run
```

前端构建与预览：

```powershell
cd frontend
npm install
npm run build
npm test
npm run dev
```

前端开发地址为 `http://localhost:5173`，请求通过 Vite 代理访问 Java 后端。生产构建由 Nginx 托管，`/api` 请求由 Nginx 反向代理到 Spring Boot。

健康检查：

```text
GET http://localhost:8080/actuator/health
GET http://localhost:8080/api/public/status
```

运行测试：

```powershell
cd backend
mvn test
```

## 配置

开发环境默认连接：

```text
jdbc:mysql://localhost:3306/ginkgo_food_map
redis://localhost:6379
```

MySQL 默认用户名为 `root`、默认密码为空。实际用户名、密码和端口都应通过环境变量覆盖，具体见 `backend/src/main/resources/application.yml`。Redis 默认无密码，也可以通过环境变量设置。

环境变量示例见 `.env.example`。不要把真实密码提交到 Git。

## 重构原则

1. 旧系统保持可运行，V2 在新目录独立开发。
2. 先建立数据库、身份和模块边界，再迁移页面功能。
3. 每次迁移一个可测试的垂直功能。
4. 跨模块只能调用对方公开接口，不能直接访问对方 Repository。
5. 第一阶段只部署一个进程；确有扩容需求时再拆微服务。
