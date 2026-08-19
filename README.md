# dsh-web-restart

DSH Web 插件：**侧边栏一键完整重启 DSH** —— 点击按钮后结束当前 `dsh web` 进程，并以完全相同命令经启动守卫重新拉起（无需 systemd/Docker 等守护进程），页面自动恢复，同时提供 agent 可调用工具。

> npm 包名 `dsh-restart` 已被同名项目占用，本插件定名 **`dsh-web-restart`**。

## 功能特性

- 🔘 **侧边栏底部重启按钮**：位于 `sidebar.footer.action` 操作区（Cordis 生命周期面板旁），点击即重启，无确认弹窗（本机信任模型）
- ♻️ **完整进程重启**：结束当前 `dsh web` 进程，以**完全相同的命令行**重新拉起（保留 `--profile` / `--patch` 及所有内层参数）
- 🛡️ **启动守卫（无守护进程）**：新进程由守卫在「旧进程已退出 + 端口已释放」后才启动，彻底避免端口占用竞态（DSH 的 webserver 启动即监听且无重试）
- 🔄 **页面自动恢复**：重启期间按钮显示「重启中…」，轮询健康检查，新进程就绪后自动刷新回到当前会话（会话由 DSH 持久化保留）
- 🧰 **agent 可调用工具**：`dsh_restart` 工具与按钮共用同一重启逻辑，可在对话中直接触发
- 🌐 中英双语 UI 文案与 README
- 🚫 幂等保护：重启在途时重复点击/调用会被拒绝

## 安装

```bash
dsh plugin --profile web add dsh-web-restart
```

重启 DSH 后生效（侧边栏底部出现按钮）。

## 使用

### Web 按钮
侧边栏底部点击「重启 DSH」即可。按钮变「重启中…」并自动轮询；新进程就绪后页面自动刷新回到当前会话。若 30 秒内未就绪，会显示错误提示（请查看运行 dsh 的终端日志）。

### Agent 工具
在对话中要求「重启一下 DSH」即可（工具名 `dsh_restart`，可选参数 `reason`）。注意：重启会**中断所有正在运行的 agent 任务与后台作业**。

## 工作原理

```
点击按钮 / 调用工具
   └─ POST /dsh-restart（幂等，单飞）
        └─ spawn 启动守卫（同一 node + 原命令行 + 环境契约）
             └─ 旧进程 1s 后退出
                  └─ 守卫轮询：旧进程退出 & 端口空闲
                       └─ 以原命令重新拉起 dsh web
                            └─ GET /dsh-restart/health 应答 → 前端自动刷新
```

- 守卫进程**不脱离原进程组**：终端 Ctrl+C 仍可正常停止重启后的 DSH，与原来一致
- HTTP 端点：`POST /dsh-restart`（触发）、`GET /dsh-restart/health`（健康检查，返回 `pid` 供前端识别新进程）
- 环境契约：`DSH_RESTARTED_BY` / `DSH_RESTART_OLD_PID` / `DSH_RESTART_PORT`

## 兼容性

- 适用于**终端前台运行 `dsh web`** 的场景（无守护进程）；在 systemd / Docker / pm2 等守护环境下同样可用（守卫会在旧进程退出后接管拉起）
- 需要 DSH `0.1.0-rc.7` 及以上

## 开发

```bash
npm run check   # 语法检查
npm test        # 单元测试 + 进程级 e2e（真实验证重启链路）
```

## 许可证

MIT
