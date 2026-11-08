# dsh-photo-pose-plugin

给 DeepSeek Harness 用的摄影姿势工具插件：拍人像、写真、情侣、闺蜜、亲子、街拍、运动、商务不知道摆什么姿势时，让模型按场景随机抽。

- `sample_photo_pose` — 按场景随机抽摄影姿势（动作要领 + 拍摄建议），默认冷却期去重（排除最近 10 次），抽到的写进 `used.log`
- `photo_pose_stats` — 库总量 / 历史抽取 / 按场景 / 按氛围

## 姿势库

60 个姿势 / 12 个场景，全部是干净内容（SFW），每个姿势都有动作要领、拍摄建议（焦段 / 机位 / 光线）和画面描述：

肖像室内 / 咖啡馆 / 城市街头 / 公园草地 / 海边 / 黄昏日落 / 山野旅行 / 校园 / 运动场 / 商务职场 / 亲子家庭 / 情侣约会，每场景 5 个。

数据**打包在这个包里**（`poses/poses.json`），装完就能用，不用另外配库。想用自己的库可以设环境变量：

- `$DSH_PHOTO_POSE_DB` — 换 poses.json 路径
- `$DSH_PHOTO_POSE_LOG` — 换 used.log 路径

默认的 used.log：用包里自带库时写 `~/.dsh/photo-pose-used.log`；用 `photo-pose-library` 目录里的库时写该目录下的 `used.log`。

## 结构

- DSH 插件是 TypeScript 模块，导出 `apply(ctx)`，用 `defineTool` 注册工具，`inject = ['tools']` 等工具注册表就绪。见官方 [Build a tool](https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/tool)。
- 打包成 bundle 靠 `package.json` 里的 `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`，安装靠 `dsh plugin add`。见官方 [Package and install a plugin](https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/publish)。
- 故意没有 `reset` 工具：模型绝不能清空 `used.log`。
- 抽取逻辑：严格模式排除全部历史；冷却期只排除最近 K 次；池子抽完先报 WARN 再从冷却里重抽。
- 工具名特意和私人小说插件错开（`sample_photo_pose` / `photo_pose_stats`），两个插件装在同一个 profile 里也不会撞名。

## 版本（2026-11-08 实测的 npm）

DSH 还是 developer preview，会断兼容，所以这里 pin 死了：

- `@deepseek-ai/dsh` 0.2.2-rc.1（`latest`）
- `@deepseek-ai/dsh-tools` 0.2.2-rc.1（`next`）
- `@deepseek-ai/cordis` ~4.1.0（dsh 0.2.2-rc.1 的依赖就是 `~4.1.0`）
- `engines.dsh: >=0.2.2-rc.1 <0.3.0`

升级 DSH 时先改这三处，再重跑 `npm run build && npm test`。

## 本地校验

```sh
cd dsh-photo-pose-plugin
npm install
npm run build   # tsc，生成 lib/
npm test        # node --test，抽取/冷却/严格/fallback/统计全覆盖
```

## 装进 DSH（测试用）

```sh
# 1. 先装 DSH（Node.js 18+）
npx @deepseek-ai/dsh web
# 2. 另开终端，进插件目录装到一个测试 profile
dsh plugin --profile demo add /path/to/dsh-photo-pose-plugin
dsh --profile demo --dump-config   # 应该能看到 "# == dsh-photo-pose-plugin" 这一层
dsh --profile demo
```

在 Web UI（默认 `http://127.0.0.1:3080`）里问一句：

> 用 sample_photo_pose 工具，在海边场景抽 3 个姿势

模型调完工具后应该返回 3 个带 `[P0xx]` 编号的姿势块，并且 `~/.dsh/photo-pose-used.log` 里多 3 行。再问 `photo_pose_stats`，应该报 60 个总量。

**注意：** 从 GitHub 装插件时 pnpm 不跑 `prepare`，TS 包会缺 `lib/` 装不上；这个包留了 `prepare: npm run build`，但那只在 `npm install` / 本地 `dsh plugin add ./...` 时生效。以后真要发 GitHub，要么发 npm 预编译版，要么让用户在 `pnpm-workspace.yaml` 里 allowBuilds，见官方发布教程的 "Installing from GitHub: the build-script catch" 一节。

## License

MIT
