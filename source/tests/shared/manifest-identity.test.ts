/**
 * tests/shared/manifest-identity.test.ts — 身份分离不变式
 * 本仓库 manifest 必须脱离上游 shuiyue-cmyk/shujuku-rebuild：
 * homePage 指向上游会让宿主 auto_update 把本插件拉回上游产物。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const manifestPath = fileURLToPath(new URL('../../../manifest.json', import.meta.url));
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

describe('manifest identity', () => {
  it('homePage 指向本仓库（脱离上游，防 auto_update 反向覆盖）', () => {
    expect(manifest.homePage).toBe('https://github.com/jiozhaoyue/ST-shujuku-rebuild');
  });
  it('display_name 已更名（脱离历史品牌）', () => {
    // 禁用名单用拼接构造：全局品牌替换（TTonly·→新品牌）不能改写本断言的名单，
    // 否则名单自指后该用例永远失败或永远通过。
    const legacyNames = ['TT' + 'only·数据库', '幻想·数据库'];
    for (const legacy of legacyNames) {
      expect(manifest.display_name).not.toBe(legacy);
    }
  });
  it('版本号进入 9.2.x 序列', () => {
    expect(manifest.version).toMatch(/^9\.[2-9]\./);
  });
  it('保持标准扩展直装形态', () => {
    expect(manifest.js).toBe('index.js');
    expect(manifest.auto_update).toBe(true);
    expect(manifest.loading_order).toBe(200);
  });
});
