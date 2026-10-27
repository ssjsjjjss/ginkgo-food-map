# Ginkgo 前端

生产前端采用 Vue 3 + TypeScript + Vite，使用 Vue Router 管理页面、Pinia 管理客户端状态、Axios 访问 Java API。生产环境由 Nginx 提供静态文件并将 `/api` 转发到 Spring Boot。

## 工程目录

```text
frontend/
├── config/              Vite、TypeScript、ESLint、Prettier 配置
├── deploy/              Docker 与 Nginx 部署文件
├── src/                 Vue 业务源码
├── .dockerignore        Docker 构建排除规则
├── .env.example         本地环境变量示例
├── index.html           Vite HTML 入口
├── package.json         npm 命令和依赖声明
├── package-lock.json    可重复安装的依赖锁文件
├── README.md            前端说明
└── tsconfig.json        TypeScript 项目引用入口
```

`node_modules/` 和 `dist/` 都是本地生成目录，已被 Git 忽略，不属于源码：前者由 `npm install` 生成，后者由 `npm run build` 生成，可以随时重新创建。

## 本地开发

```powershell
npm install
npm run dev
```

Vite 默认监听 `http://localhost:5173`，并把 `/api` 代理到 `http://localhost:8080`。如需修改开发代理目标：

```powershell
$env:VITE_DEV_PROXY_TARGET="http://localhost:8081"
npm run dev
```

## 验证

```powershell
npm run check
npm run typecheck
npm run lint
npm test
npm run build
```

`npm run check` 会依次执行代码检查、单元测试和生产构建，是提交前的默认验证命令。目录职责和依赖规则见 `docs/architecture/frontend.md`。

## Nginx 部署

后端在本机运行时，可以从项目根目录构建并启动前端容器：

```powershell
docker compose up -d --build frontend
```

打开 `http://localhost`。Nginx 的后端目标通过 `BACKEND_HOST` 和 `BACKEND_PORT` 配置；部署成完整容器网络后，将其改为后端服务名即可。

后续按店铺列表、地图、评价、身份认证和后台管理的顺序重新实现。V2 不包含旧版单文件前端，需要对照时查看独立的原项目目录。
