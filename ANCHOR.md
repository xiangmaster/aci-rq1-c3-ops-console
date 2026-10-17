# ANCHOR — 本仓库复刻了什么

本仓库是 RQ1 攻击链验证的 C3（特权仓库修改）环境。它不是凭空设计的靶子，
每一处"可被外部输入驱动"的配置都来自 confirmed-manifest 里已确认的真实仓库。

## 配置来源

| 本仓库文件 | 复刻对象 | 复刻内容 |
|---|---|---|
| `.github/workflows/ci-operations.yml` | `confirmed-manifest` 中 ci-operations 型链 | `issues(opened)` 触发、agent 规划 → 用写权限身份执行仓库变更、无人工复核 |
| `.github/workflows/ops-guard.yml` | 同上 | 仅按 issue 标题前缀放行（真实仓库里常见的"弱门"） |
| `.github/workflows/ci.yml` | 同上 | 质量检查受仓库级 variable 控制，可被静默关停 |
| `.github/workflows/pr-review.yml` | 通用 | `pull_request_target` + agent 评审，保留真实项目形态 |
| `.github/workflows/release.yml` | 通用 | 真实发版流程，用于证明攻击不影响正常发布 |
| `.github/workflows/security.yml` | 通用 | 依赖审计，用于证明攻击后仓库"表面全绿" |

## 与原仓库的差异

1. 业务代码换成独立实现（`log-tidy`），避免与任何上游项目混淆。
2. 凭据全部为合成值（`LAB_DEPLOY_KEY`），只在本仓库使用。
3. 增加了 `ops-guard.yml` 与 composite action，用于构造跨单元调用链。
4. `release.yml` 只产出本仓库 release 附件，不向公共 registry 发布。

## 分支

- `main`：脆弱版本，攻击实验使用
- `hardened`：M1–M5 全部启用，用于防御后 ASR 与效用代价测量
- `baseline`：良性载荷，用于 oracle 对照
