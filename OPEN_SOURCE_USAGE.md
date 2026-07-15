# Ozon Growth Agent Open Source Usage Policy

Maintainer: Yang Cao
Email: cao.x.yang@gmail.com

This repository is released under the MIT License. To make downstream use clear and consistent, please follow these project-level usage rules in addition to the license itself.

## Allowed

- Use, study, modify, fork, and redistribute the source code under the terms of the MIT License.
- Use the project in personal, internal, educational, research, and commercial scenarios.
- Build derivative products or workflows on top of this repository.

## Required

- Keep the copyright notice and MIT license notice in source distributions and substantial portions of the software.
- Keep SPDX / MIT file headers in first-party source files when redistributing or modifying them.
- Clearly mark your own modifications when you publish a fork, packaged extension, or derivative version.
- Review and comply with the terms of service, robots rules, privacy requirements, and API usage policies of Ozon, Google Trends, 1688, Taobao, and any other third-party services you connect to.

## Not Allowed

- Do not imply that Yang Cao endorses, certifies, audits, or guarantees your fork, packaged extension, service, or business results unless you have explicit written permission.
- Do not remove attribution and present this repository as an original work created entirely by another party.
- Do not use this repository to violate applicable law, platform policy, data-protection obligations, or third-party intellectual-property rights.

## Third-Party Components

- Some dependencies and assets in this repository may be provided under their own licenses.
- You are responsible for checking and complying with those upstream licenses when redistributing binaries, bundled assets, or modified builds.

## Browser Permissions and Local Data

- The extension currently uses broad host permissions because user-triggered workflows may open and analyze Ozon, Google/Yandex/Bing, Google Trends, 1688, Taobao/Tmall, and related evidence pages.
- The reference manifest intentionally keeps broad all-URL access for now so evidence workflows remain fast and reliable across those pages.
- Do not present this permission as background data collection. The reference implementation stores reports, workflow checkpoints, task logs, Seller API snapshots, and evidence metadata locally in the user's browser.
- If you redistribute a packaged version, explain the host permission scope clearly and consider optional host permissions for stricter environments.
- Persistent `chrome.storage.local` keys are registered in `modules/storageKeys.js`; downstream changes should keep owner, sensitivity, and retention metadata current.

## No Warranty

- This project is provided on an "as is" basis under the MIT License.
- You are responsible for validating business logic, AI outputs, browser automation behavior, compliance assumptions, and deployment safety in your own environment.

---

# Ozon Growth Agent 开源使用规范

维护者：Yang Cao
邮箱：cao.x.yang@gmail.com

本仓库基于 MIT License 开源。为便于二次开发、分发和商业使用时保持一致性，除 MIT 协议本身外，请同时遵守以下项目级使用规范。

## 允许

- 在 MIT 协议范围内使用、学习、修改、Fork 和再分发本项目源码。
- 将本项目用于个人、内部、教学、研究和商业场景。
- 基于本项目构建派生产品、浏览器插件、工作流或服务。

## 必须遵守

- 在源码分发版和软件的重要部分中保留版权声明与 MIT 许可声明。
- 再分发或修改一方源码文件时，保留文件头部的 SPDX / MIT 声明。
- 对公开发布的 Fork、打包版扩展或派生版本，清楚标注你自己的修改内容。
- 当你把本项目连接到 Ozon、Google Trends、1688、淘宝或其他第三方服务时，自行遵守对应平台的服务条款、抓取规则、隐私要求和 API 使用政策。

## 不允许

- 未经 Yang Cao 书面明确许可，不得暗示你的 Fork、打包扩展、服务或商业结果获得了其背书、认证、审计或保证。
- 不得移除署名后将本项目整体表述为由其他主体完全原创开发。
- 不得利用本项目实施违反适用法律、平台规则、数据保护义务或第三方知识产权的行为。

## 第三方组件

- 本仓库中的部分依赖或资产可能受其各自上游许可证约束。
- 你在再分发二进制、打包产物、静态资源或修改版本时，仍需自行检查并遵守这些第三方许可证。

## 浏览器权限与本地数据

- 当前扩展仍使用较宽的 host permissions，因为用户触发的工作流需要打开并分析 Ozon、Google/Yandex/Bing、Google Trends、1688、淘宝/天猫等证据页面。
- 参考 manifest 现阶段有意保留较宽的 all-URL 访问，以保证跨站证据工作流快速可靠。
- 不应把该权限表述为后台采集用户数据。参考实现将报告、工作流断点、任务日志、Seller API 快照和证据元数据保存在用户浏览器本地。
- 如果你再分发打包版本，应清楚解释 host permission 范围，并在更严格的企业环境中考虑 optional host permissions。
- 持久化 `chrome.storage.local` key 已登记在 `modules/storageKeys.js`，下游修改应同步维护 owner、敏感度和保留策略。

## 免责声明

- 本项目按 MIT 协议“按现状”提供，不附带额外担保。
- 业务逻辑、AI 输出、浏览器自动化结果、合规假设和部署安全，均应由使用者在自己的环境中自行验证。
