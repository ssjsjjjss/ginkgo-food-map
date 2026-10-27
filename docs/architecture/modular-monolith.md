# 模块化单体架构

## 当前决策

V2 第一阶段使用模块化单体，而不是立即部署多个微服务。

原因：当前服务器只有 2 核 CPU 和 2 GB 内存。一个 Spring Boot 进程加 MySQL 与轻量 Redis 能承载求职展示和社团低并发访问，同时仍可通过清晰的业务边界为未来拆分微服务做准备。

## 模块

| 模块 | 职责 | 拥有的数据 |
| --- | --- | --- |
| user | 用户、身份、角色 | 用户、角色、用户角色关系 |
| restaurant | 餐厅档案、分类、位置 | 餐厅、分类、标签 |
| review | 评价、评分、回复 | 评价、维度评分、回复 |
| admin | 审核、回收站、管理操作 | 管理操作记录 |
| file | 图片元数据和对象存储适配 | 文件元数据 |
| security | 认证、授权、安全上下文 | 登录令牌或会话 |
| common | 通用错误和技术基础设施 | 不拥有业务数据 |

## 依赖规则

```text
user       restaurant
  \           /
   \         /
      review
        |
      admin

security -> user
file     <- restaurant / review
```

图中表示业务协作关系，不代表可以访问对方 Repository。跨模块协作必须通过公开接口或事件完成。

## 部署形态

```text
Browser
   |
 Nginx
   |
Spring Boot modular monolith
   |           |
 MySQL       Redis
```

当前只生成一个 JAR。未来需要拆分时，优先考虑认证、文件和评价模块，但拆分必须由独立扩容、独立发布或团队边界等真实需求驱动。
