# 架构文档

## 文档

- [前端架构](frontend.md)
- [后端架构](backend.md)
- [数据与存储](data-storage.md)
- [部署架构](deployment.md)
- [后端架构与兑换码调研](../backend-architecture-redemption-research.md)

## 总体结构

```text
浏览器用户端 / 管理端
        |
        v
Fastify API 后端
        |
        +-- PostgreSQL：用户、积分、套餐、模型配置、兑换码、视频记录
        +-- Mock Provider：当前用户视频任务成功/失败流转
        +-- OpenAI Video 兼容供应商适配器：已接真实提交/状态查询/内容下载代码路径，当前本地由开关启用
        +-- Redis/BullMQ：真实供应商任务后台状态同步
        +-- 服务器文件目录：保存 3 天视频文件，后续可迁移对象存储
        +-- 第三方视频模型 API：URL 和 Key 仅后端可见
```
