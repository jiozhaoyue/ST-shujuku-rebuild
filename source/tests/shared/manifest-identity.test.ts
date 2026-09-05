/**
 * tests/shared/manifest-identity.test.ts — 身份分离不变式
 * 本仓库 manifest 必须脱离 shuiyue-cmyk/shujuku-rebuild：
 * homePage 指向上游会让宿主 auto_update 把本插件拉回上游产物。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const manifestPath = fileURLToPath(new URL('../../../manifest.json', import.meta.url));
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

describe('manifest identity', () => {
  it('homePage 不指向上游 rebuild 仓库', () => {
    expect(manifest.homePage).not.toContain('shujuku-rebuild');
  });
  it('display_name 已更名（脱离 TTonly / 幻想）', () => {
    expect(manifest.display_name).not.toBe('TTonly·数据库');
    expect(manifest.display_name).not.toBe('幻想·数据库');
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
