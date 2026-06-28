# 上下文文档

上下文文档用于任务中断后的恢复，不替代需求文档和模块文档。

## 文档

- [长期上下文](long-term-context.md)：稳定事实、架构决策、长期约束。
- [当前窗口上下文](current-session.md)：当前正在做什么、刚完成什么、下一步是什么。
- [新对话轻量接力提示词](new-chat-prompt.md)：新开对话时复制粘贴给助手，避免重新灌入大量历史。

## 使用方式

新开对话或任务中断后，优先读取：

1. [../../PROJECT.md](../../PROJECT.md)
2. [new-chat-prompt.md](new-chat-prompt.md)
3. [current-session.md](current-session.md)
4. [long-term-context.md](long-term-context.md)
