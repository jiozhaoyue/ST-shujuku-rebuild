# 安全门禁与隔离

> 本插件把 AI 生成的内容写进用户数据库，同时又允许用户配任意 API 端点——两处都是攻击面。
> 这一页只写**已经被代码钉住的约束**，以及踩过的具体回归。

---

## 一、端点安全（SSRF 门禁）

单一入口：`shared/utils.ts:588` 的 `assertSafeHttpEndpoint_ACU(endpoint, { allowUnsafe })`。

### 默认（`allowUnsafe = false`）

- 非 `http(s)` 协议、协议相对 URL（`//host`）、含反斜杠、无法解析 → 一律拒绝，消息为可直接展示的中文（`:591-606`）。
- `http://` 只允许 `localhost` / `127.0.0.1` / `::1`（`:609`，消息：`端点使用 http:// 时仅允许 localhost；远程地址请使用 https://。`）。
- 私网 / 回环 / 链路本地地址拒绝（`:648`）。

### 开关打开后（全局设置 `allowUnsafeApiEndpoints`）

- **放行**：`http://` 远程主机、私网/回环 IP。
- **仍然永久封禁**（与开关无关，`:636-639`）：
  - 链路本地 `169.254/16`（含云元数据 `169.254.169.254`）与 IPv6 链路本地 `fe80::/10`；
  - 云元数据**主机名**：`metadata.google.internal`、`metadata.goog`、`instance-data`（`:495-497`）；
  - 阿里云元数据 `100.100.100.200`（`:534`）；
  - 未指定地址（`0.0.0.0`、`::`）、组播与保留段；
  - 非 http(s) 协议、协议相对 URL、反斜杠、以及 IPv4-mapped IPv6 雾化形态（`:612-615` 还原成点分十进制再判）。
  - 错误消息原文：`端点指向链路本地/未指定/组播/保留地址（含云元数据 169.254.169.254），这类地址不会因开启「允许不安全端点」而放行。`

### 放行时的告警

命中「因开关放行」时记一条 `logWarn_ACU`，**按主机去重**（`shared/utils.ts:578` 附近），另发一次性 toast——提示请求头（含 API 密钥）可能以明文发出。

### 接线点（6 处，改门禁必须同步）

| 位置 | 说明 |
| --- | --- |
| `service/ai/api-call.ts:330` | 主 AI 调用 |
| `service/ai/ai-service.ts:131` | 连通性/模型拉取 |
| `service/vector/vector-memory-config.ts:500` | 向量记忆配置校验 |
| `data/gateways/vector-embedding-gateway.ts:202` | 向量嵌入 |
| `data/gateways/vector-rerank-gateway.ts:130` | 向量重排 |
| `presentation-v2/components/ApiConfigPanel.vue:435` | UI 前置校验 |

读取侧统一走 `allowUnsafeApiEndpointsEnabled_ACU()`（`service/settings/settings-readers.ts`）；设置页开关在 `presentation-v2/pages/ApiPage.vue`，状态经 `composables/useApiEndpointSecuritySettings.ts` 落 `settings_ACU.allowUnsafeApiEndpoints`。

**默认关闭时错误文案与行为必须逐字节不变**（既有用例钉住）。云元数据被拒必须有独立钉子用例。

---

## 二、SQL 写入受限

AI 侧的写操作不得是裸 SQL 字符串：走 `shared/restricted-sql-dml.ts` 的 `RestrictedSqlStatement_ACU`（`insert` / `update` / `delete` 三态，值域 `string | number | null`）。标识符映射走 `shared/sql-identifier-mapper.ts`；DDL 投影（隐藏列、`row_id` 保护）走 `shared/ddl-utils.ts`（参数错误直接抛中文 `Error`，例：`:256` `row_id 不允许隐藏。`）。

---

## 三、数据隔离槽位

`shared/isolation-policy.ts:1-9`：标签隔离**已退役**，未开启时槽位键固定为 `''`。

- **空串是合法槽位**，只拒绝 `null` / `undefined`。
- **禁止 `if (!key)` 当读写门禁** —— 9.0 回归：交火索引指针写不进、删不掉。
- 存量 `IsolatedData['']` 与历史隔离码槽位按原键读写，**不删旧路径**。

---

## 四、存储身份

`shared/constants.ts:15` 的 `UNIQUE_SCRIPT_ID = 'shujuku_v120'` 是存储命名空间根（`shujuku_v120__userscript_settings_v1`、`TavernDB_ACU_*` 聊天字段前缀配套）。

**改它 = 换存储身份 = 现有用户数据全部"丢失"**。只有做独立副本时才改（规则另有：`TavernDB_ACU_*` 结构必须与上游同构）。

---

## 五、本仓不该入库的东西

- `.rescue-out/`（救援工具本地输出，含用户会话数据）—— `.gitignore` 已排除。
- 任何密钥、证书、`.env`（`.gitignore` 已排除）。端点安全开关的提示文案同样按「不写凭据明文」处理。
- 真实聊天数据样本（`*.zip`、`data-*/`、`samples/`）。
- 开发者身份文件：`.trellis/.developer`（各人不同，已排除）。

---

## 反模式

- 新增一处直接 `fetch(endpoint)` 而不过 `assertSafeHttpEndpoint_ACU`。
- 为了让局域网自建服务能用，去放宽/删除「永久封禁」段——那正是开关刻意不放的部分。
- 在放行告警里打印完整 URL（含 query 上的 key）而不是仅主机名。
- 用 `if (!key)` 判隔离槽。

## 验证

```bash
cd source
npx vitest run tests/shared     # 端点放行/封禁矩阵 + 云元数据独立钉子用例
# 门禁接线点自查（期望 6 处 + 1 处函数定义）
grep -rn "assertSafeHttpEndpoint_ACU(" src/ | wc -l
```
