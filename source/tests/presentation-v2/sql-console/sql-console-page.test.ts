/**
 * AdvancedToolsPage SQL 面板集成 — SQL 控制台布局、执行与历史
 *
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const STORAGE_KEY = 'acu_v2_ui_state';

async function mountAdvancedToolsSqlPanel(opts: {
  queryResult?: { columns: string[]; values: any[][]; rowCount: number };
  mutationResult?: { changes: number; errors: string[] };
} = {}) {
  vi.resetModules();
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  // 合并而非整键覆盖：持久化往返用例要在二次挂载时保住首次挂载写入的其它 section（如草稿）
  const seeded = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as Record<string, unknown>;
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...seeded, router: { activePageId: 'advanced-tools' } }));

  const executeQuery = vi.fn(() => opts.queryResult ?? {
    columns: ['name'],
    values: [['背包物品表']],
    rowCount: 1,
  });
  const executeMutation = vi.fn(() => opts.mutationResult ?? { changes: 1, errors: [] });
  const provider = {
    executeQuery,
    executeMutation,
  };
  const getStorageProvider = vi.fn(() => provider);
  const ensureStorageProviderReady = vi.fn(async () => provider);

  vi.doMock('../../../src/service/runtime/state-manager', () => ({
    settings_ACU: {
      storageMode: 'sqlite',
      plotSettings: { enabled: false },
      summaryVectorIndexModeDefault: false,
    },
    currentJsonTableData_ACU: {},
    currentChatFileIdentifier_ACU: 'chat-sql',
    coreApisAreReady_ACU: true,
    isAutoUpdatingCard_ACU: false,
    getCurrentIsolationKey_ACU: () => '',
  }));
  vi.doMock('../../../src/service/table/storage-mode', () => ({
    isSqliteMode: () => true,
    getCurrentStorageMode: () => 'sqlite',
  }));
  vi.doMock('../../../src/service/table/table-storage-strategy', () => ({
    isStorageRuntimeReadyForSyncRead_ACU: () => true,
    getStorageProvider,
    ensureStorageProviderReady_ACU: ensureStorageProviderReady,
  }));

  const sqlConsole = await import('../../../src/presentation-v2/composables/useSqlConsole');
  sqlConsole.__resetSqlConsoleHistoryForTests();
  sqlConsole.__resetSqlConsoleSnippetsForTests();

  const mount = await import('../../../src/presentation-v2/bootstrap/mount');
  await mount.openAcuV2App();
  await new Promise(r => setTimeout(r, 0));

  return {
    mount,
    executeQuery,
    executeMutation,
    getStorageProvider,
  };
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const page = () => document.querySelector<HTMLElement>('[data-ub-main]')!;
const sqlSection = () => page().querySelector<HTMLElement>('#at-sql')!;
const tick = () => new Promise(r => setTimeout(r, 0));
const buttonByText = (root: ParentNode, text: string) => Array.from(root.querySelectorAll<HTMLButtonElement>('button'))
  .find(button => button.textContent?.trim() === text || button.textContent?.includes(text));

async function openDisclosure(label: string): Promise<void> {
  const head = Array.from(sqlSection().querySelectorAll<HTMLButtonElement>('.ub-disc__head'))
    .find(button => button.textContent?.includes(label))!;
  if (head.getAttribute('aria-expanded') !== 'true') head.click();
  await tick();
}

async function openHistory(): Promise<void> {
  const head = Array.from(sqlSection().querySelectorAll<HTMLButtonElement>('.ub-disc__head'))
    .find(button => button.textContent?.includes('执行历史'))!;
  if (head.getAttribute('aria-expanded') !== 'true') head.click();
  await tick();
}

describe('AdvancedToolsPage SQL panel', () => {

  it('输入 SELECT 后执行，展示查询表格并记录历史；点历史回填编辑器', async () => {
    const { mount, executeQuery } = await mountAdvancedToolsSqlPanel({
      queryResult: {
        columns: ['id', 'name'],
        values: [[1, '药水']],
        rowCount: 1,
      },
    });

    const textarea = sqlSection().querySelector<HTMLTextAreaElement>('textarea[aria-label="SQL 语句"]');
    expect(textarea).not.toBeNull();
    textarea!.value = 'SELECT id, name FROM item;';
    textarea!.dispatchEvent(new Event('input', { bubbles: true }));
    await tick();

    buttonByText(sqlSection(), '执行')!.click();
    await tick();

    expect(executeQuery).toHaveBeenCalledWith('SELECT id, name FROM item;');
    const result = sqlSection().querySelector('[aria-label="SQL 执行结果"]')!;
    expect(result.textContent).toContain('药水');
    expect(result.textContent).toContain('1 行');

    buttonByText(sqlSection(), '清空')!.click();
    await tick();
    expect(textarea!.value).toBe('');

    await openHistory();
    const historyItem = sqlSection().querySelector<HTMLButtonElement>('.ub-at__history');
    expect(historyItem).not.toBeNull();
    expect(historyItem!.tagName).toBe('BUTTON');
    expect(historyItem!.classList.contains('is-ok')).toBe(true);
    expect(historyItem!.textContent).toContain('成功');
    expect(historyItem!.querySelector('code')?.textContent).toBe('SELECT id, name FROM item;');
    historyItem!.click();
    await tick();
    expect(textarea!.value).toBe('SELECT id, name FROM item;');

    mount.__resetAcuV2MountForTests();
  });

  it('大结果集只渲染窗口内行，「显示更多」逐窗追加，注记随全量显示消失', async () => {
    const rows = Array.from({ length: 450 }, (_, i) => [i + 1, `row-${i + 1}`]);
    const { mount } = await mountAdvancedToolsSqlPanel({
      queryResult: {
        columns: ['id', 'name'],
        values: rows,
        rowCount: 450,
      },
    });

    const textarea = document.querySelector<HTMLTextAreaElement>('#at-sql textarea[aria-label="SQL 语句"]');
    expect(textarea).not.toBeNull();
    textarea!.value = 'SELECT id, name FROM item;';
    textarea!.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));

    const executeButton = Array.from(document.querySelectorAll<HTMLButtonElement>('#at-sql button'))
      .find(button => button.textContent?.includes('执行'));
    executeButton!.click();
    await new Promise(r => setTimeout(r, 0));

    const tbodyRowCount = () =>
      document.querySelectorAll('#at-sql .ub-at__table tbody tr').length;
    // 窗口默认 200 行：450 行结果只渲染 200 行，注记提示共 450 行
    expect(tbodyRowCount()).toBe(200);
    let text = document.querySelector('#at-sql')?.textContent || '';
    expect(text).toContain('已折叠较早的 250 行');
    expect(text).toContain('450 行');
    expect(text).toContain('row-200');
    expect(text).not.toContain('row-201');

    // 「显示更多」逐窗追加：200 → 400 → 450，追平后注记消失
    const moreButton = () =>
      Array.from(document.querySelectorAll<HTMLButtonElement>('#at-sql .ub-at__result button'))
        .find(button => button.textContent?.includes('显示更多'));
    moreButton()!.click();
    await new Promise(r => setTimeout(r, 0));
    expect(tbodyRowCount()).toBe(400);

    moreButton()!.click();
    await new Promise(r => setTimeout(r, 0));
    expect(tbodyRowCount()).toBe(450);
    expect(moreButton()).toBeUndefined();
    text = document.querySelector('#at-sql')?.textContent || '';
    expect(text).toContain('row-450');

    mount.__resetAcuV2MountForTests();
  });

  it('SQL 草稿跨重开持久化——写入落盘后，重挂载自动恢复到编辑器', async () => {
    // 第一次挂载：输入语句，等防抖落盘（300ms + 余量）
    const first = await mountAdvancedToolsSqlPanel();
    const firstTextarea = document.querySelector<HTMLTextAreaElement>('#at-sql textarea[aria-label="SQL 语句"]');
    expect(firstTextarea).not.toBeNull();
    firstTextarea!.value = 'SELECT id, name FROM item WHERE id = 7;';
    firstTextarea!.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 700));
    first.mount.__resetAcuV2MountForTests();

    // 草稿已进统一持久化根键
    const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as Record<string, unknown>;
    expect(persisted.sqlConsoleDraft).toBe('SELECT id, name FROM item WHERE id = 7;');

    // 第二次挂载：编辑器应预填草稿
    const second = await mountAdvancedToolsSqlPanel();
    const secondTextarea = document.querySelector<HTMLTextAreaElement>('#at-sql textarea[aria-label="SQL 语句"]');
    expect(secondTextarea).not.toBeNull();
    expect(secondTextarea!.value).toBe('SELECT id, name FROM item WHERE id = 7;');

    second.mount.__resetAcuV2MountForTests();
  });

  it('常用语句收藏：收藏去重置顶、点击仅填入编辑器、可删除、持久化入 ui-state', async () => {
    const { mount } = await mountAdvancedToolsSqlPanel();
    const textarea = document.querySelector<HTMLTextAreaElement>('#at-sql textarea[aria-label="SQL 语句"]');
    expect(textarea).not.toBeNull();

    const findButton = (label: string) =>
      Array.from(document.querySelectorAll<HTMLButtonElement>('#at-sql button'))
        .find(button => button.textContent?.includes(label));

    // 输入并收藏
    textarea!.value = 'SELECT name FROM beiwanglu;';
    textarea!.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    findButton('存为常用')!.click();
    await new Promise(r => setTimeout(r, 0));

    // 常用语句抽屉默认收起，先展开再断言 chip
    await openDisclosure('常用语句');

    // chip 渲染且持久化
    const chipText = () => document.querySelector('.ub-at__snippet code')?.textContent;
    expect(chipText()).toBe('SELECT name FROM beiwanglu;');
    let persisted = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as { sqlConsoleSnippets?: string[] };
    expect(persisted.sqlConsoleSnippets).toEqual(['SELECT name FROM beiwanglu;']);

    // 再次收藏同语句 → 去重（不重复出现）
    textarea!.value = 'SELECT name FROM beiwanglu;';
    textarea!.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    findButton('存为常用')!.click();
    await new Promise(r => setTimeout(r, 0));
    expect(document.querySelectorAll('.ub-at__snippet')).toHaveLength(1);
    expect((JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as { sqlConsoleSnippets?: string[] }).sqlConsoleSnippets)
      .toEqual(['SELECT name FROM beiwanglu;']);

    // 清空编辑器 → 点击 chip 只填入、不执行（executeQuery 不会被调用）
    findButton('清空')!.click();
    await new Promise(r => setTimeout(r, 0));
    expect(textarea!.value).toBe('');
    (document.querySelector('.ub-at__snippet') as HTMLElement).click();
    await new Promise(r => setTimeout(r, 0));
    expect(textarea!.value).toBe('SELECT name FROM beiwanglu;');

    // 删除：chip 消失且持久化同步
    (document.querySelector('.ub-at__snippet-remove') as HTMLElement).click();
    await new Promise(r => setTimeout(r, 0));
    expect(document.querySelectorAll('.ub-at__snippet')).toHaveLength(0);
    persisted = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as { sqlConsoleSnippets?: string[] };
    expect(persisted.sqlConsoleSnippets).toEqual([]);

    mount.__resetAcuV2MountForTests();
  });

  it('快捷查看所有表会填入 SQL 并立即执行', async () => {
    const { mount, executeQuery } = await mountAdvancedToolsSqlPanel();

    buttonByText(sqlSection(), '查看所有表')!.click();
    await tick();

    expect(executeQuery).toHaveBeenCalledWith(expect.stringContaining('sqlite_master'));
    const textarea = sqlSection().querySelector<HTMLTextAreaElement>('textarea[aria-label="SQL 语句"]');
    expect(textarea?.value).toContain('sqlite_master');
    expect(sqlSection().textContent || '').toContain('背包物品表');

    mount.__resetAcuV2MountForTests();
  });

  it('执行变更失败时展示错误结果，历史记为失败', async () => {
    const { mount, executeMutation } = await mountAdvancedToolsSqlPanel({
      mutationResult: { changes: 0, errors: ['no such table: item'] },
    });

    const textarea = sqlSection().querySelector<HTMLTextAreaElement>('textarea[aria-label="SQL 语句"]')!;
    textarea.value = "UPDATE item SET name = 'x';";
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    await tick();

    buttonByText(sqlSection(), '执行')!.click();
    await tick();

    expect(executeMutation).toHaveBeenCalledWith("UPDATE item SET name = 'x';", undefined);
    expect(sqlSection().querySelector('.ub-at__error')?.textContent).toContain('no such table: item');
    await openHistory();
    expect(sqlSection().querySelector('.ub-at__history.is-fail')?.textContent).toContain('失败');

    mount.__resetAcuV2MountForTests();
  });
});
