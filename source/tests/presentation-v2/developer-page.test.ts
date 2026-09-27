/**
 * DeveloperPage 集成 — 开发者字段与运行参数
 *
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const STORAGE_KEY = 'acu_v2_ui_state';

function createSettings() {
  return {
    autoUpdateThreshold: 3,
    autoUpdateFrequency: 2,
    updateBatchSize: 2,
    maxConcurrentGroups: 1,
    skipUpdateFloors: 0,
    retainRecentLayers: 100,
    autoUpdateTokenThreshold: 500,
    tableMaxRetries: 3,
    tableEditLastPairOnly: true,
    tableContextExtractTags: '',
    tableContextExtractRules: [],
    tableContextExcludeTags: '',
    tableContextExcludeRules: [],
    storageMode: 'native',
    tableApiPreset: '',
    charCardPrompt: [
      { role: 'USER', content: '主任务', mainSlot: 'A', isMain: true, deletable: false },
      { role: 'USER', content: '数据段', mainSlot: 'B', isMain2: true, deletable: false },
    ],
    apiPresets: [],
    defaultApiPresetName: '',
    apiPresetBindingsByChat: {},
    contentOptimizationSettings: { apiPreset: '' },
    tableApiPresetOverridesByName: {},
  } as any;
}

async function mountDeveloperPage(devOptions: Record<string, unknown> = {}) {
  vi.resetModules();
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      router: { activePageId: 'developer' },
      devOptions: { developerOptionsEnabled: true, ...devOptions },
    }),
  );

  const settings = createSettings();
  const saveSettings = vi.fn(() => ({ saved: true, storageType: 'memory' }));

  vi.doMock('../../src/service/runtime/state-manager', () => ({
    settings_ACU: settings,
    currentChatFileIdentifier_ACU: 'chat-dev',
    currentJsonTableData_ACU: {},
    coreApisAreReady_ACU: true,
    getCurrentIsolationKey_ACU: () => '',
  }));
  vi.doMock('../../src/service/settings/settings-service', () => ({
    saveSettings_ACU: saveSettings,
    setGlobalPlotEnabled_ACU: vi.fn(),
    setSummaryVectorIndexMode_ACU: vi.fn(),
  }));
  vi.doMock('../../src/service/table/storage-mode', () => ({
    getCurrentStorageMode: () => settings.storageMode,
    isSqliteMode: () => false,
  }));
  vi.doMock('../../src/service/chat/chat-service', () => ({
    getChatArray_ACU: () => [],
  }));
  vi.doMock('../../src/service/template/chat-scope', () => ({
    getSortedSheetKeys_ACU: () => [],
    getCurrentChatPlotScopeState_ACU: () => null,
    setCurrentChatPlotScopeState_ACU: vi.fn(),
  }));
  vi.doMock('../../src/service/template/template-preset-service', () => ({
    getActiveTemplatePresetMeta_ACU: () => ({ displayName: '默认预设', scopeLabel: '全局' }),
  }));
  vi.doMock('../../src/service/ai/ai-service', () => ({
    getConnectionManagerProfiles_ACU: () => [],
    fetchAvailableModels_ACU: vi.fn(async () => ({ success: true, models: [] })),
  }));

  const mount = await import('../../src/presentation-v2/bootstrap/mount');
  await mount.openAcuV2App();
  await new Promise(r => setTimeout(r, 0));
  return { mount, settings, saveSettings };
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('DeveloperPage', () => {
  it('渲染开发者开关和填表执行参数', async () => {
    const { mount } = await mountDeveloperPage();

    const page = document.querySelector('.acu-v2-developer-page');
    expect(page).not.toBeNull();
    const text = page!.textContent || '';
    expect(text).toContain('开发者 gated 字段');
    expect(text).toContain('填表执行参数');
    expect(text).toContain('最大并发更新组数');

    mount.__resetAcuV2MountForTests();
  });

  it('最大并发更新组数输入会保存到 settings', async () => {
    const { mount, settings, saveSettings } = await mountDeveloperPage();

    const panel = Array.from(document.querySelectorAll<HTMLElement>('.acu-v2-developer-page .acu-panel'))
      .find(el => el.querySelector('.acu-panel__title')?.textContent?.includes('填表执行参数'))!;
    const input = panel.querySelector<HTMLInputElement>('input[type="number"]')!;
    input.value = '4';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await Promise.resolve();

    expect(settings.maxConcurrentGroups).toBe(4);
    expect(saveSettings).toHaveBeenCalled();

    mount.__resetAcuV2MountForTests();
  });
});

describe('DeveloperPage · 环境与能力总览', () => {
  const settle = (): Promise<void> => new Promise(r => setTimeout(r, 0));

  /**
   * 面板从**宿主全局**读 API 分组索引（UI 不得 import `presentation/bootstrap/api-registry` —— 那是
   * 安装全局 API 的副作用模块，拽进 app 图会连带打挂无关用例）。测试同样按这条路装一份假索引。
   */
  const FAKE_API_INDEX: Record<string, string[]> = {
    'core-data': ['exportTableAsJson', 'triggerUpdate'],
    'table-crud': ['createSheet', 'deleteSheet', 'renameSheet'],
    settings: ['getApiPresets'],
  };
  function installFakeApiIndex(): void {
    (globalThis as any).__ACU_API_GROUP_INDEX__ = FAKE_API_INDEX;
    (globalThis as any).AutoCardUpdaterAPI = Object.fromEntries(
      Object.values(FAKE_API_INDEX).flat().map(name => [name, () => undefined]),
    );
  }
  const fakeTotal = Object.values(FAKE_API_INDEX).reduce((sum, list) => sum + list.length, 0);

  function overviewPanel(): HTMLElement {
    return Array.from(document.querySelectorAll<HTMLElement>('.acu-v2-developer-page .acu-panel'))
      .find(el => el.querySelector('.acu-panel__title')?.textContent?.includes('环境与能力总览'))!;
  }

  it('面板渲染：环境事实 + 运行时可调用方法计数徽章', async () => {
    installFakeApiIndex();
    const { mount } = await mountDeveloperPage();

    const panel = overviewPanel();
    expect(panel).toBeTruthy();
    const text = panel.textContent || '';
    expect(text).toContain('宿主');
    expect(text).toContain('构建戳');
    expect(text).toContain('存储模式');
    // 徽章报的是**运行时实际可调用**数（假索引与假 API 对象大小一致）
    expect(text).toContain(`可调用 ${fakeTotal} 个方法`);

    mount.__resetAcuV2MountForTests();
  });

  it('分组默认收起，展开后列出该组方法名（来自全局分组索引）', async () => {
    installFakeApiIndex();
    const { mount } = await mountDeveloperPage();

    const groupName = 'core-data';
    const panel = overviewPanel();
    const header = () => Array.from(panel.querySelectorAll<HTMLButtonElement>('.acu-disclosure-group__header'))
      .find(node => (node.textContent || '').includes(groupName))!;
    expect(header().getAttribute('aria-expanded')).toBe('false');

    header().click();
    await settle();
    expect(header().getAttribute('aria-expanded')).toBe('true');
    const bodyText = overviewPanel().textContent || '';
    for (const method of FAKE_API_INDEX[groupName]) expect(bodyText).toContain(method);

    mount.__resetAcuV2MountForTests();
  });

  it('持久化面列出四类通道，字段清单与数据层常量一致', async () => {
    installFakeApiIndex();
    const { mount } = await mountDeveloperPage();
    const { MESSAGE_TABLE_FIELDS_ACU, FIRST_MESSAGE_SCOPE_GUIDE_FIELDS_ACU } =
      await import('../../src/data/repositories/chat-message-data-repo');

    const text = overviewPanel().textContent || '';
    for (const channel of ['聊天消息字段', 'chat[0] 镜像 + chatMetadata', '浏览器本地', '服务端向量文件']) {
      expect(text, `缺少通道 ${channel}`).toContain(channel);
    }
    // 字段名来自数据层常量（不是抄的），抽两个代表做存在性断言
    expect(text).toContain(MESSAGE_TABLE_FIELDS_ACU[0]);
    expect(text).toContain(FIRST_MESSAGE_SCOPE_GUIDE_FIELDS_ACU[0]);

    mount.__resetAcuV2MountForTests();
  });

  it('「复制总览给 AI」把脱敏文本写进剪贴板', async () => {
    installFakeApiIndex();
    const { mount } = await mountDeveloperPage();
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(globalThis.navigator, 'clipboard', { value: { writeText }, configurable: true });

    const button = Array.from(overviewPanel().querySelectorAll<HTMLButtonElement>('button'))
      .find(b => (b.textContent || '').includes('复制总览给 AI'))!;
    button.click();
    await settle();
    await settle();

    expect(writeText).toHaveBeenCalledTimes(1);
    // 断言结构而不是具体数字：报告必须含三节标题，说明它是拼出来的而不是空串
    const payload = String(writeText.mock.calls[0][0]);
    expect(payload).toContain('数据库插件能力与存储总览');
    expect(payload).toContain('可调用的公开 API');
    expect(payload).toContain('状态持久化面');

    mount.__resetAcuV2MountForTests();
  });
});

describe('DeveloperPage · 提示词检查器', () => {
  /** 稳定等待 Vue 把订阅回调带来的响应式变更渲染到 DOM。 */
  const settle = (): Promise<void> => new Promise(r => setTimeout(r, 0));

  function inspectionPanel(): HTMLElement {
    return Array.from(document.querySelectorAll<HTMLElement>('.acu-v2-developer-page .acu-panel'))
      .find(el => el.querySelector('.acu-panel__title')?.textContent?.includes('提示词检查器'))!;
  }

  /**
   * 记录级折叠组。必须限定为记录容器的直接子元素：
   * 记录体内的「消息明细」也用同一个 _lib 折叠组件，且默认 bodyMode='show' 会把它们
   * 一并渲染进 DOM（仅 v-show 隐藏），不限定就会把消息组也算进来。
   */
  function recordGroups(): HTMLElement[] {
    return Array.from(
      inspectionPanel().querySelectorAll<HTMLElement>('.acu-v2-prompt-inspection__records > .acu-disclosure-group'),
    );
  }

  it('面板渲染，默认关闭并给出引导空态', async () => {
    const { mount } = await mountDeveloperPage();

    const panel = inspectionPanel();
    expect(panel).toBeTruthy();
    const text = panel.textContent || '';
    expect(text).toContain('未开启');
    expect(text).toContain('还没有记录');
    // 默认关闭时开关为 off，且不显示任何记录头
    expect(panel.querySelector('.acu-toggle')?.getAttribute('aria-checked')).toBe('false');
    expect(recordGroups()).toHaveLength(0);

    mount.__resetAcuV2MountForTests();
  });

  it('打开「开始记录」会推送观察器并持久化到既有 devOptions 节', async () => {
    const { mount } = await mountDeveloperPage();
    const observer = await import('../../src/service/ai/prompt-observer');
    expect(observer.isPromptObservationEnabled_ACU()).toBe(false);

    inspectionPanel().querySelector<HTMLButtonElement>('.acu-toggle')!.click();
    await settle();

    expect(observer.isPromptObservationEnabled_ACU()).toBe(true);
    const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    expect(persisted.devOptions.promptInspectEnabled).toBe(true);

    mount.__resetAcuV2MountForTests();
  });

  it('非填表记录展开后显示统计、diff 与「未分段」显式态', async () => {
    const { mount } = await mountDeveloperPage({ promptInspectEnabled: true });
    const observer = await import('../../src/service/ai/prompt-observer');
    observer.recordPromptAssembly_ACU({
      messages: [
        { role: 'system', content: '你是正文替换助手' },
        { role: 'user', content: '改写这段' },
      ],
      effectiveApiConfig: { model: 'test-model', url: 'https://api.example.com/v1/chat', streamingEnabled: true },
      overrides: { sessionNamespace: 'content-replace' },
    });
    await settle();

    const panel = inspectionPanel();
    const group = panel.querySelector<HTMLElement>('.acu-disclosure-group')!;
    expect(group).toBeTruthy();
    expect(group.querySelector('.acu-disclosure-group__label')?.textContent).toContain('#1');
    expect(group.querySelector('.acu-disclosure-group__label')?.textContent).toContain('content-replace');

    group.querySelector<HTMLElement>('.acu-disclosure-group__header')!.click();
    await settle();

    const body = group.textContent || '';
    expect(body).toContain('基线建立');
    expect(body).toContain('api.example.com');
    expect(body).toContain('未分段');
    expect(body).toContain('消息明细（2 条）');

    mount.__resetAcuV2MountForTests();
  });

  it('填表记录展开后显示分段占比与未归类差额', async () => {
    const { mount } = await mountDeveloperPage({ promptInspectEnabled: true });
    const observer = await import('../../src/service/ai/prompt-observer');
    observer.recordPromptAssembly_ACU({
      messages: [{ role: 'user', content: '模板 + 注入后的最终正文' }],
      effectiveApiConfig: { model: 'm', url: 'https://h.example', streamingEnabled: false },
      overrides: {
        sessionNamespace: 'table-fill',
        promptSegments: [
          { name: '骨架', chars: 4 },
          { name: '表数据与DDL', chars: 6 },
        ],
      },
    });
    await settle();

    const group = inspectionPanel().querySelector<HTMLElement>('.acu-disclosure-group')!;
    group.querySelector<HTMLElement>('.acu-disclosure-group__header')!.click();
    await settle();

    const body = group.textContent || '';
    expect(body).toContain('骨架');
    expect(body).toContain('表数据与DDL');
    expect(body).toContain('未归类差额');

    mount.__resetAcuV2MountForTests();
  });

  it('清空按钮把列表恢复成空态', async () => {
    const { mount } = await mountDeveloperPage({ promptInspectEnabled: true });
    const observer = await import('../../src/service/ai/prompt-observer');
    observer.recordPromptAssembly_ACU({
      messages: [{ role: 'user', content: 'x' }],
      effectiveApiConfig: { model: 'm', url: 'https://h.example', streamingEnabled: false },
      overrides: { sessionNamespace: 'summary' },
    });
    await settle();
    expect(recordGroups()).toHaveLength(1);

    const clearButton = Array.from(inspectionPanel().querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.includes('清空'))!;
    clearButton.click();
    await settle();

    expect(observer.getPromptObservations_ACU()).toHaveLength(0);
    expect(inspectionPanel().textContent).toContain('还没有记录');
    expect(recordGroups()).toHaveLength(0);

    mount.__resetAcuV2MountForTests();
  });

  it('导出按钮触发下载且内容来自观察器（已脱敏）', async () => {
    const { mount } = await mountDeveloperPage({ promptInspectEnabled: true });
    const observer = await import('../../src/service/ai/prompt-observer');
    observer.recordPromptAssembly_ACU({
      messages: [{ role: 'user', content: '正文' }],
      effectiveApiConfig: { model: 'm', url: 'https://h.example', streamingEnabled: false },
      overrides: { sessionNamespace: 'summary' },
    });
    await settle();

    const createObjectURL = vi.fn(() => 'blob:acu-test');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    const exportButton = Array.from(inspectionPanel().querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.includes('导出 JSON'))!;
    exportButton.click();
    await settle();

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    // 传进 Blob 的内容来自观察器导出：是合法 JSON 且含记录
    const blobArg = createObjectURL.mock.calls[0][0] as Blob;
    expect(blobArg).toBeInstanceOf(Blob);

    clickSpy.mockRestore();
    mount.__resetAcuV2MountForTests();
  });
});
