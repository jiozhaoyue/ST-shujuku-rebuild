/**
 * service/ai/prompt-builder/prompt-api-call.ts
 * AI API 调用 — prompt 组装 + API 调用 + 流式/非流式响应处理
 * 从 prompt-builder.ts 拆出（L195-L501 + L1519-L1604）
 */
import {
  currentAbortController_ACU,
  trackAbortController_ACU,
  untrackAbortController_ACU,
  _set_currentAbortController_ACU
} from '../../runtime/state-manager';
import {
  getApiConfigByPreset_ACU,
  buildCustomApiRequestBody_ACU,
  postChatCompletion_ACU
} from '../api-call';
import {
  isPromptObservationEnabled_ACU,
  PROMPT_PLACEHOLDER_SEGMENT_ACU,
  PROMPT_SEGMENT_SKELETON_ACU,
  PROMPT_SEGMENT_TABLE_WORLDBOOK_ACU,
  type PromptSegmentStat_ACU,
} from '../prompt-observer';
import { acquirePresetRateLimitSlot_ACU } from '../preset-rate-limiter';
import {
  currentJsonTableData_ACU,
  settings_ACU
} from '../../runtime/state-manager';
import {
  getPersonaDescription_ACU,
  getCharDescription_ACU
} from '../../../data/gateways/host-state-gateway';
import {
  logDebug_ACU,
  logError_ACU,
  logWarn_ACU,
  normalizeExcludeRules_ACU
} from '../../../shared/utils';
import {
  applyExcludeRulesToText_ACU,
  getLatestAIMessageContent_ACU,
  getPlotFromHistory_ACU,
  parseIfBlocksInContent_ACU,
  parseRandomTags_ACU,
  replaceRandomVariables_ACU
} from '../../runtime/helpers-remaining';
import {
  replaceDbSqlVariables
} from '../../runtime/template-vars/sql-query-var';
import {
  isSqliteMode
} from '../../table/storage-mode';

/**
 * The request reached a provider successfully, but its body contained no
 * usable model output. This is retryable without treating configuration,
 * authentication, or transport failures as model-output failures.
 */
export class RetryableAiResponseError_ACU extends Error {
  readonly code = 'empty_or_invalid_api_response';

  constructor(message = 'API响应格式不正确或内容为空。') {
    super(message);
    this.name = 'RetryableAiResponseError';
  }
}

  function createPromptTemplateNonce_ACU(): string {
    try {
      const randomUUID = (globalThis as any)?.crypto?.randomUUID;
      if (typeof randomUUID === 'function') {
        const uuid = String(randomUUID.call((globalThis as any).crypto) || '');
        if (uuid) return uuid.replace(/[^a-zA-Z0-9_-]/g, '');
      }
    } catch { /* 老宿主无 crypto 时走带进程内熵的兜底 */ }
    return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
  }

  /**
   * 把不可信 payload 变成对 EJS/random/SQL/ORM/if 均惰性的 nonce token。
   * 所有候选 token 都对本轮可信模板与全部不可信源做包含检查；即使随机源重复或
   * payload 猜中候选，也会继续换一个 token，避免恢复时覆盖/串值。
   */
  function createUntrustedTemplateGuard_ACU(reservedValues: unknown[]) {
    const occupiedTexts = reservedValues.map(value => value === null || value === undefined ? '' : String(value));
    const tokenValues = new Map<string, string>();
    const valueTokens = new Map<string, string>();
    let tokenIndex = 0;

    const buildToken = (): string => {
      for (let attempt = 0; attempt < 1024; attempt += 1) {
        const nonce = createPromptTemplateNonce_ACU() || 'fallback';
        const token = `__ACU_TABLE_FILL_UNTRUSTED_${nonce}_${tokenIndex++}__`;
        if (tokenValues.has(token)) continue;
        if (occupiedTexts.some(text => text.includes(token))) continue;
        occupiedTexts.push(token);
        return token;
      }
      throw new Error('table_fill_untrusted_placeholder_nonce_collision');
    };

    return {
      protect(value: unknown): string {
        const text = value === null || value === undefined ? '' : String(value);
        if (!text) return '';
        const existing = valueTokens.get(text);
        if (existing) return existing;
        const token = buildToken();
        valueTokens.set(text, token);
        tokenValues.set(token, text);
        return token;
      },
      restore(value: unknown): string {
        let restored = value === null || value === undefined ? '' : String(value);
        for (const [token, payload] of tokenValues) restored = restored.split(token).join(payload);
        return restored;
      },
    };
  }

  function normalizeRoleForApi_ACU(role: any) {
    const ru = String(role || '').toUpperCase();
    const rl = String(role || '').toLowerCase();
    if (ru === 'AI' || ru === 'ASSISTANT' || rl === 'assistant') return 'assistant';
    if (ru === 'SYSTEM' || rl === 'system') return 'system';
    if (ru === 'USER' || rl === 'user') return 'user';
    return 'user';
  }

  export async function callCustomOpenAI_ACU(dynamicContent: any, abortController: AbortController | null = null, options: any = null) {
    const localAbortController = abortController || new AbortController();
    _set_currentAbortController_ACU(localAbortController);
    trackAbortController_ACU(localAbortController);
    const abortSignal = localAbortController.signal;
    const skipProfileSwitch = !!options?.skipProfileSwitch;
    const forceDirectApi = !!options?.forceDirectApi;
    // 提示词观测（R7 零开销）：关闭时下面所有分段统计全部短路，行为与未见观测器时逐字一致。
    const observePrompt_ACU = isPromptObservationEnabled_ACU();
    // 段级统计：段名 → 注入字符数。占位符替换点天然就是分段边界（见下方单遍替换注释）。
    const segmentChars_ACU = new Map<string, number>();
    // 每条消息被注入的字符数（下标与 messages 对齐），用于反推「骨架」= 模板自身的静态文本量。
    const injectedCharsPerMessage_ACU: number[] = [];
    const addSegmentChars_ACU = (name: string | undefined, chars: number): void => {
        if (!name || chars <= 0) return;
        segmentChars_ACU.set(name, (segmentChars_ACU.get(name) || 0) + chars);
    };

    const effectiveTableApiPreset = options?.tableApiPreset !== undefined
        ? String(options.tableApiPreset)
        : (settings_ACU.tableApiPreset || '');
    const apiPresetConfig = getApiConfigByPreset_ACU(effectiveTableApiPreset);
    const effectiveApiMode = apiPresetConfig.apiMode;
    const effectiveApiConfig = apiPresetConfig.apiConfig;
    const effectiveTavernProfile = apiPresetConfig.tavernProfile;

    const messages: Array<{ role: string; content: string }> = [];
    const sqliteMode = isSqliteMode();
    const charCardPromptSetting = settings_ACU.charCardPrompt;

    let promptSegments = [];
    if (Array.isArray(charCardPromptSetting)) {
        promptSegments = charCardPromptSetting;
    } else if (typeof charCardPromptSetting === 'string') {
        promptSegments = [{ role: 'USER', content: charCardPromptSetting }];
    }

    let userInfoContent_Table = '';
    try {
      userInfoContent_Table = getPersonaDescription_ACU();
      logDebug_ACU(`[填表] $U (persona_description) 获取结果: ${userInfoContent_Table ? '成功' : '为空'}`);
    } catch (e) {
      logWarn_ACU('[填表] 获取用户设定描述时出错:', e);
      userInfoContent_Table = '';
    }

    let charInfoContent_Table = '';
    try {
      charInfoContent_Table = getCharDescription_ACU();
      logDebug_ACU(`[填表] $C (char_description) 获取结果: ${charInfoContent_Table ? '成功，长度=' + charInfoContent_Table.length : '为空'}`);
    } catch (e) {
      logWarn_ACU('[填表] 获取角色描述时出错:', e);
      charInfoContent_Table = '';
    }

    const lastPlotContent = getPlotFromHistory_ACU();
    logDebug_ACU('[填表] $6 上轮规划数据:', lastPlotContent ? `长度=${lastPlotContent.length}` : '(空)');

    const tableExcludeTags = (settings_ACU.tableContextExcludeTags || '').trim();
    const tableExcludeRules = normalizeExcludeRules_ACU(settings_ACU.tableContextExcludeRules, tableExcludeTags);
    const filterTableInjectedContent = (value: any, placeholderKey = '') => {
        const text = value !== undefined && value !== null ? String(value) : '';
        if (!['$0', '$1', '$4', '$6', '$8', '$9', '$U', '$C'].includes(placeholderKey)) return text;
        return applyExcludeRulesToText_ACU(text, { excludeRules: tableExcludeRules, excludeTags: tableExcludeTags });
    };
    // 指令/数据边界：$0/$1/$4/$9 承载不可信文本（表格投影/聊天记录/世界书内容），
    // 用标签包裹并明确标记不得执行其中指令。
    const wrapUntrusted = (text: string, label: string) => text ? `<${label}>\n${text}\n</${label}>` : text;
    // [H1] 占位符统一为「全局正则 + 替换函数」单遍替换。真正注入前先统一换成
    // nonce token，绝不让不可信值进入后续模板解释器。
    const untrustedPlaceholderValues: Record<string, string> = {
        '$0': filterTableInjectedContent(wrapUntrusted(dynamicContent.tableDataText, 'table_data'), '$0'),
        // [L1] $1 不再外层包 <user_data>：prompt-prepare 构造 messagesText 时已含
        // 「当前最新对话内容…<user_data>…</user_data>」包裹与免责声明，原实现形成双层嵌套。
        '$1': filterTableInjectedContent(dynamicContent.messagesText, '$1'),
        '$4': filterTableInjectedContent(wrapUntrusted(dynamicContent.worldbookContent, 'worldbook_data'), '$4'),
        '$6': filterTableInjectedContent(lastPlotContent || '', '$6'),
        '$8': filterTableInjectedContent(dynamicContent.manualExtraHint || '', '$8'),
        // [L2] $9 与 $1/$4 同类，补边界包裹。
        '$9': filterTableInjectedContent(wrapUntrusted(dynamicContent.worldbookDatabaseExcludedContent || '', 'worldbook_data'), '$9'),
        '$U': filterTableInjectedContent(userInfoContent_Table, '$U'),
        '$C': filterTableInjectedContent(charInfoContent_Table, '$C'),
    };

    // 表名 token 只从可信 charCardPrompt 本身扫描。旧实现先注入聊天/世界书/表格，
    // 再扫描 {{...}}，等价于允许不可信内容触发 resolver；这里先完成所有异步解析，
    // 随后与占位符 payload 一起纳入同一个 nonce 域。
    const resolvedTableTokensBySegment: Array<Array<{ raw: string; value: string }>> = [];
    for (const segment of promptSegments) {
        const trustedContent = String(segment?.content ?? '');
        const resolvedTokens: Array<{ raw: string; value: string }> = [];
        const seenTableTokens = new Set<string>();
        for (const match of trustedContent.matchAll(/\{\{([^{}]+)\}\}/g)) {
            const raw = String(match[0] || '');
            if (!raw || seenTableTokens.has(raw)) continue;
            seenTableTokens.add(raw);
            if (typeof dynamicContent?.resolveTableWorldbookContent !== 'function') continue;
            const tableName = String(match[1] || '');
            try {
                const resolvedContent = await dynamicContent.resolveTableWorldbookContent(tableName);
                if (typeof resolvedContent === 'string') resolvedTokens.push({ raw, value: resolvedContent });
            } catch (error) {
                logWarn_ACU(`[填表] 无法解析表名占位符 "${tableName}"，保留原 token。`, error);
            }
        }
        resolvedTableTokensBySegment.push(resolvedTokens);
    }

    const untrustedGuard = createUntrustedTemplateGuard_ACU([
        ...promptSegments.map(segment => segment?.content ?? ''),
        ...Object.values(untrustedPlaceholderValues),
        ...resolvedTableTokensBySegment.flat().map(token => token.value),
    ]);

    try {
        for (let segmentIndex = 0; segmentIndex < promptSegments.length; segmentIndex += 1) {
            const segment = promptSegments[segmentIndex];
            let finalContent = String(segment?.content ?? '');
            // 观测开启时顺便记下「本段被注入的字符数」：替换进正文的是占位符值的原样长度
            // （值先被 nonce 保护、出站前原样还原），因此这里量到的就是该段的真实贡献。
            let injectedChars_ACU = 0;
            finalContent = finalContent.replace(/\$(?:0|1|4|6|8|9|U|C)/g, (match: string) => {
                const placeholderValue = untrustedPlaceholderValues[match];
                if (observePrompt_ACU && typeof placeholderValue === 'string') {
                    addSegmentChars_ACU(PROMPT_PLACEHOLDER_SEGMENT_ACU[match], placeholderValue.length);
                    injectedChars_ACU += placeholderValue.length;
                }
                return untrustedGuard.protect(placeholderValue);
            });
            for (const token of resolvedTableTokensBySegment[segmentIndex] || []) {
                if (observePrompt_ACU && typeof token.value === 'string') {
                    addSegmentChars_ACU(PROMPT_SEGMENT_TABLE_WORLDBOOK_ACU, token.value.length);
                    injectedChars_ACU += token.value.length;
                }
                finalContent = finalContent.split(token.raw).join(untrustedGuard.protect(token.value));
            }

            if (typeof (globalThis as any).EjsTemplate?.evalTemplate === 'function') {
              try {
                finalContent = await (globalThis as any).EjsTemplate.evalTemplate(finalContent);
                logDebug_ACU('[填表] 已通过 st-prompt-template 处理提示词');
              } catch (e) {
                logWarn_ACU('[填表] st-prompt-template 处理失败，使用原始内容:', e);
              }
            }

            finalContent = parseRandomTags_ACU(finalContent);
            finalContent = replaceRandomVariables_ACU(finalContent);

            // [P4] {[db...]}/{[sql...]} 值替换（SQLite 模式下，在 <if> 之前执行）
            finalContent = replaceDbSqlVariables(finalContent);

            if (settings_ACU.promptTemplateSettings?.enabled !== false) {
              // 填表条件必须与本次 $1 实际读取的 AI 上下文一致，不能越过批次边界读取聊天最新层。
              const conditionalSeedContent = typeof dynamicContent?.conditionalSeedContent === 'string'
                ? dynamicContent.conditionalSeedContent
                : getLatestAIMessageContent_ACU();
              const templateContext = {
                seedContent: conditionalSeedContent,
                allTablesJson: currentJsonTableData_ACU,
                plotContent: lastPlotContent || ''
              };
              finalContent = parseIfBlocksInContent_ACU(finalContent, templateContext, 0);
            }

            messages.push({ role: normalizeRoleForApi_ACU(segment.role), content: finalContent });
            injectedCharsPerMessage_ACU.push(injectedChars_ACU);
        }
    } finally {
        // 全部模板处理完成后才把不可信 payload 一次性放回出站文本。
        for (const message of messages) message.content = untrustedGuard.restore(message.content);
    }

    // 段级报告的收尾：此刻 messages 已是最终出站文本（payload 已还原），
    // 「骨架」= 每条消息的最终长度 − 该条被注入的字符数（模板自身的静态文本 + 模板处理产物）。
    // 由此 sum(各段) === 各消息字符总和，账是平的；宿主侧后续的 role 归一 / 非预填充改写
    // 造成的少量增量由观测器记在 unsegmentedChars，仍可审计。
    let observedSegments_ACU: PromptSegmentStat_ACU[] | undefined;
    if (observePrompt_ACU) {
        let skeletonChars_ACU = 0;
        for (let messageIndex = 0; messageIndex < messages.length; messageIndex += 1) {
            skeletonChars_ACU += Math.max(0, messages[messageIndex].content.length - (injectedCharsPerMessage_ACU[messageIndex] || 0));
        }
        addSegmentChars_ACU(PROMPT_SEGMENT_SKELETON_ACU, skeletonChars_ACU);
        observedSegments_ACU = [...segmentChars_ACU.entries()]
            .map(([name, chars]) => ({ name, chars }))
            // 骨架置顶，其余按注入量降序：面板上一眼看到「谁占了预算」。
            .sort((a, b) => (a.name === PROMPT_SEGMENT_SKELETON_ACU ? -1
                : b.name === PROMPT_SEGMENT_SKELETON_ACU ? 1
                : b.chars - a.chars));
    }

    logDebug_ACU('Final messages array being sent to API:', messages);
    logDebug_ACU(`使用API预设: ${effectiveTableApiPreset || '当前配置'}, 模式: ${effectiveApiMode}`);

    try {
        if (!effectiveApiConfig.url || !effectiveApiConfig.model) {
            throw new Error('自定义API的URL或模型未配置。');
        }
        // 公益站兼容（预设级）：该预设限速每分钟最多 3 次请求（各预设独立计数）
        if (apiPresetConfig.publicServiceMode) {
            await acquirePresetRateLimitSlot_ACU(effectiveTableApiPreset || '_current_config', { signal: abortSignal });
        }
        logDebug_ACU('ACU: 调用后端生成 API, Model:', effectiveApiConfig.model);
        const content = await postChatCompletion_ACU(buildCustomApiRequestBody_ACU(messages, effectiveApiConfig, { stripModelPrefix: false, nonPrefillSupport: apiPresetConfig.nonPrefillSupport, sessionNamespace: 'table-fill', ...(observedSegments_ACU ? { promptSegments: observedSegments_ACU } : {}) }), abortSignal);
        if (content) {
            return content.trim();
        }
        throw new RetryableAiResponseError_ACU();
    } finally {
        untrackAbortController_ACU(localAbortController);
        if (currentAbortController_ACU === localAbortController) {
            _set_currentAbortController_ACU(null);
        }
    }
  }

  // ═══ 响应处理（streamingEnabled 开启时走 SSE 流解析，否则 JSON 解析） ═══

  /**
   * 一次 AI 调用实际报告的 token 用量。
   * 字段缺失表示提供商未报告，明确的 0 表示提供商报告该项为 0。
   */
  export interface AiUsageMetadata_ACU {
    promptTokens?: number;
    completionTokens?: number;
    /** 命中厂商 prompt 缓存的输入 token 数，通常包含在 promptTokens 内。 */
    cachedTokens?: number;
    /** 厂商报告的缓存写入 token 数。 */
    cacheWriteTokens?: number;
  }

  function toUsageCount_ACU(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= 0
      ? value
      : undefined;
  }

  function firstUsageCount_ACU(...values: unknown[]): number | undefined {
    for (const value of values) {
      const count = toUsageCount_ACU(value);
      if (count !== undefined) return count;
    }
    return undefined;
  }

  /** 后出现的已定义字段覆盖先前值；缺失字段不得擦除已经报告的计数。 */
  function mergeAiUsageMetadata_ACU(
    current: AiUsageMetadata_ACU | null,
    incoming: AiUsageMetadata_ACU | null,
  ): AiUsageMetadata_ACU | null {
    if (!incoming) return current;
    const merged: AiUsageMetadata_ACU = current ? { ...current } : {};
    if (incoming.promptTokens !== undefined) merged.promptTokens = incoming.promptTokens;
    if (incoming.completionTokens !== undefined) merged.completionTokens = incoming.completionTokens;
    if (incoming.cachedTokens !== undefined) merged.cachedTokens = incoming.cachedTokens;
    if (incoming.cacheWriteTokens !== undefined) merged.cacheWriteTokens = incoming.cacheWriteTokens;
    return merged;
  }

  /** 同一响应中先合并 usage，再由 usageMetadata 的已定义字段覆盖。 */
  function extractResponseUsageMetadata_ACU(raw: any): AiUsageMetadata_ACU | null {
    return mergeAiUsageMetadata_ACU(
      extractAiUsageMetadata_ACU(raw?.usage),
      extractAiUsageMetadata_ACU(raw?.usageMetadata),
    );
  }

  /**
   * 从 OpenAI、Anthropic、DeepSeek 或 Gemini 兼容 usage 对象提取统一用量。
   * 只接受非负有限整数；字段缺失或非法时保持未报告，显式 0 会被保留。
   * @param raw 响应里的 usage 或 usageMetadata 对象
   * @returns 统一用量；raw 不含任何有效计数时返回 null
   */
  export function extractAiUsageMetadata_ACU(raw: any): AiUsageMetadata_ACU | null {
    if (!raw || typeof raw !== 'object') return null;
    const promptTokens = firstUsageCount_ACU(raw.prompt_tokens, raw.input_tokens, raw.promptTokenCount);
    const completionTokens = firstUsageCount_ACU(raw.completion_tokens, raw.output_tokens, raw.candidatesTokenCount);
    const cachedTokens = firstUsageCount_ACU(
      raw.prompt_tokens_details?.cached_tokens,
      raw.input_tokens_details?.cached_tokens,
      raw.cache_read_input_tokens,
      raw.prompt_cache_hit_tokens,
      raw.cachedContentTokenCount,
    );
    const cacheWriteTokens = firstUsageCount_ACU(
      raw.cache_creation_input_tokens,
      raw.cache_write_input_tokens,
      raw.cache_write_tokens,
    );

    const usage: AiUsageMetadata_ACU = {};
    if (promptTokens !== undefined) usage.promptTokens = promptTokens;
    if (completionTokens !== undefined) usage.completionTokens = completionTokens;
    if (cachedTokens !== undefined) usage.cachedTokens = cachedTokens;
    if (cacheWriteTokens !== undefined) usage.cacheWriteTokens = cacheWriteTokens;
    return Object.keys(usage).length ? usage : null;
  }

  async function parseNonStreamResponse_ACU(response: any, onUsage?: (usage: AiUsageMetadata_ACU) => void) {
    try {
        const data = await response.json();
        const usage = extractResponseUsageMetadata_ACU(data);
        if (usage && onUsage) {
          try { onUsage(usage); } catch { /* 用量回调异常不允许影响响应主流程。 */ }
        }
        if (data?.choices?.[0]?.message?.content) {
            return data.choices[0].message.content;
        }
        if (data?.content) {
            return data.content;
        }
        if (typeof data === 'string') {
            return data;
        }
        logError_ACU('[parseNonStreamResponse] Unknown response format:', data);
        return null;
    } catch (e: any) {
        // response.json() 是响应体读取阶段；AbortError 来自用户取消/上层超时信号，
        // 不可降级为 null，否则调用层会把取消/超时误报成可重试的模型响应错误。
        if (e?.name === 'AbortError') throw e;
        logError_ACU('[parseNonStreamResponse] Failed to parse response:', e);
        return null;
    }
  }

  /**
   * 读流期间「连续无数据」的诊断阈值。
   * 本常量只用于**报**（logDebug），不用于**掐**：中断语义归 api-call 的 120s 计时器独有
   * （INTERNAL_AI_FETCH_TIMEOUT_MS_ACU，覆盖正文读取，在 finally 清理）。两个阈值各管一件事，避免互相打架。
   */
  export const SSE_STALL_DIAG_MS_ACU = 30_000;

  interface SseParseState_ACU {
    result: string;
    sawDone: boolean;
    usage: AiUsageMetadata_ACU | null;
  }

  /**
   * 观测回调：绝不 await、绝不抛错 —— 观测异常不允许影响响应主流程。
   * 不传回调时只是一次布尔判断（关闭观测零额外开销）。
   */
  function notifySseDelta_ACU(delta: string, onDelta?: (delta: string) => void): void {
    if (!onDelta) return;
    try { onDelta(delta); } catch { /* 观测异常不影响响应主流程。 */ }
  }

  /**
   * 处理一行 SSE 文本，就地更新 state。
   *
   * **增量路径与整读回退共用本函数** —— 「逐字节一致」由此在构造上成立，
   * 而不是靠两处实现各自写对。判定顺序、trim 时机、解析失败的静默忽略均与拆分前逐字等价。
   */
  function consumeSseLine_ACU(line: string, state: SseParseState_ACU, onDelta?: (delta: string) => void): void {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return;
    const payload = trimmed.slice(5).trim();
    if (!payload) return;
    if (payload === '[DONE]') {
      state.sawDone = true;
      return;
    }
    try {
      const data = JSON.parse(payload);
      const delta = data?.choices?.[0]?.delta?.content;
      if (typeof delta === 'string') {
        state.result += delta;
        notifySseDelta_ACU(delta, onDelta);
      }
      const usage = extractResponseUsageMetadata_ACU(data);
      state.usage = mergeAiUsageMetadata_ACU(state.usage, usage);
      // Anthropic SSE 分支（claude_messages 接口协议）
      if (data?.type === 'content_block_delta' && data?.delta?.type === 'text_delta' && typeof data?.delta?.text === 'string') {
        state.result += data.delta.text;
        notifySseDelta_ACU(data.delta.text, onDelta);
      } else if (data?.type === 'message_stop') {
        state.sawDone = true;
      }
    } catch {
      // 忽略无法解析的 data 行（注释/空行）
    }
  }

  /**
   * 把增量文本切成行，语义与 `text.split('\n')` 等价：
   * 末行无换行也算一行；`\r\n` 的行尾 `\r` 由消费方的 `trim()` 处理；
   * 空行原样交给消费方（由它自己忽略）。末尾恰好换行时不产生多余空行。
   */
  function createSseLineSplitter_ACU(onLine: (line: string) => void) {
    let buffer = '';
    return {
      push(chunk: string): void {
        buffer += chunk;
        let index: number;
        while ((index = buffer.indexOf('\n')) !== -1) {
          onLine(buffer.slice(0, index));
          buffer = buffer.slice(index + 1);
        }
      },
      flush(): void {
        if (buffer) {
          onLine(buffer);
          buffer = '';
        }
      },
    };
  }

  // SSE 流式响应解析：逐行提取 data: 前缀的 JSON，拼接 choices[0].delta.content。
  // 兼容 Claude Messages 原样透传的 Anthropic SSE（接口协议=claude_messages 时 TT 不归一化流）：
  // content_block_delta(text_delta).delta.text 拼内容，message_stop 视为流结束（等价 [DONE]）。
  // usage 出现在流末尾的独立 chunk（choices 为空数组），需开启 stream_options.include_usage 才会下发。
  //
  // 读取形态按**能力检测**分流（不是异常兜底）：
  //   - response.body 有 getReader ⇒ 真流式增量读取（可诊断停滞、可判截断）；
  //   - 否则 ⇒ 退回 await response.text() 整读（测试桩 / 不支持流体的宿主）。
  // 两条路径汇聚到 consumeSseLine_ACU，故返回值恒等。
  async function parseStreamResponse_ACU(
    response: any,
    onUsage?: (usage: AiUsageMetadata_ACU) => void,
    onDelta?: (delta: string) => void,
  ) {
    let stallTimer: ReturnType<typeof setTimeout> | null = null;
    try {
      const state: SseParseState_ACU = { result: '', sawDone: false, usage: null };
      const body = response?.body;
      if (body && typeof body.getReader === 'function') {
        const reader = body.getReader();
        const splitter = createSseLineSplitter_ACU(line => consumeSseLine_ACU(line, state, onDelta));
        // TextDecoder 必须带 { stream: true }：正文含中文，chunk 边界可能切在字符中间，
        // 不带 stream 会把半个字符静默解成 U+FFFD；EOF 时再 decode() 一次冲掉解码器内部残留。
        const decoder = new TextDecoder();
        let stallReported = false;
        const armStallDiag = (): void => {
          if (stallReported) return; // 只报一次，不刷屏
          if (stallTimer !== null) clearTimeout(stallTimer);
          stallTimer = setTimeout(() => {
            stallReported = true;
            logDebug_ACU(`[parseStreamResponse] 流式响应连续 ${SSE_STALL_DIAG_MS_ACU / 1000}s 无数据（只报不掐，中断仍由 120s 计时器负责）。`);
          }, SSE_STALL_DIAG_MS_ACU);
        };
        armStallDiag();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          armStallDiag();
          splitter.push(decoder.decode(value, { stream: true }));
        }
        splitter.push(decoder.decode());
        splitter.flush();
      } else {
        const text = await response.text();
        for (const line of text.split('\n')) consumeSseLine_ACU(line, state, onDelta);
      }
      if (state.usage && onUsage) {
        try { onUsage(state.usage); } catch { /* 用量回调异常不允许影响响应主流程。 */ }
      }
      if (!state.sawDone) {
        // [M1] 流式响应未收到 [DONE]：按截断处理，丢弃部分内容返回 null。
        // 上游 callCustomOpenAI 会把 null 转成 RetryableAiResponseError_ACU（model 类可重试错误），
        // collectGroupFillResponse 据此走重试；此前仅告警仍返回半截内容，会让调用方把截断误判为成功。
        // 本函数拿不到 abort 标志，一律按截断处理（用户中止场景在 fetch 层已抛 AbortError，不会走到这里）。
        logWarn_ACU(`[parseStreamResponse] 流式响应未收到 [DONE]（可能被网络中断/截断），丢弃已收集的部分内容，长度: ${state.result.length}`);
        return null;
      }
      if (!state.result) {
        logWarn_ACU('[parseStreamResponse] 流式响应未解析出任何内容。');
      }
      return state.result || null;
    } catch (e: any) {
      // 响应体读取（含 reader.read()）可能在流尚未读完时因用户取消/内部超时而抛 AbortError。
      // 解析失败可降级为 null，但控制流取消必须穿透到调用层分类。
      if (e?.name === 'AbortError') throw e;
      logError_ACU('[parseStreamResponse] Failed to parse stream:', e);
      return null;
    } finally {
      // 与 api-call 的计时器同一纪律：不清理会随轮数堆积。
      if (stallTimer !== null) clearTimeout(stallTimer);
    }
  }

  /**
   * 响应解析分流：按「请求实际携带的 stream 值」而非全局开关——
   * 预设级流式开关可能与全局不同，若按全局判断会把 SSE 当 JSON（或反之）解析失败。
   * requestWantsStream 缺省时回退全局 settings_ACU.streamingEnabled（兼容旧调用方）。
   */
  export async function handleApiResponse_ACU(response: any, requestWantsStream?: boolean, onUsage?: (usage: AiUsageMetadata_ACU) => void, onDelta?: (delta: string) => void) {
    const wantsStream = requestWantsStream !== undefined
      ? requestWantsStream === true
      : settings_ACU.streamingEnabled === true;
    if (wantsStream) {
      return await parseStreamResponse_ACU(response, onUsage, onDelta);
    }
    return await parseNonStreamResponse_ACU(response, onUsage);
  }
