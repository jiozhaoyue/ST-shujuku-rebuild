/**
 * tests/shared/http-endpoint-guard.test.ts
 * 端点安全门禁（assertSafeHttpEndpoint_ACU）行为矩阵。
 *
 * 本文件钉住两件事：
 * 1. **默认路径逐字节不变**（开关关闭时文案与既有一致）—— 防止「加开关顺手改默认行为」；
 * 2. **开关的分级放行边界** —— allowUnsafe 只放行私网/环回与 http 远程，
 *    链路本地（含云元数据 169.254.169.254）、未指定、组播与保留段**任何情况下都拒**。
 *
 * 为什么云元数据要单独钉：它是本开关唯一真正危险的放行目标（云环境凭据泄漏）。
 * 若将来有人把 isAlwaysBlockedHost_ACU 放宽，这些用例必须先失败。
 */
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { _resetUnsafeEndpointNoticeForTests_ACU, assertSafeHttpEndpoint_ACU } from '../../src/shared/utils';
import { isWarnLogEnabled, setWarnLogEnabled } from '../../src/shared/log-buffer';
import { registerUiSurface_ACU, resetUiSurfaceRegistryForTests_ACU } from '../../src/shared/ui-surface-registry';

/**
 * 放行提示有模块级去重状态（按主机 + 每会话一次），用例之间必须清空，
 * 否则后面的用例会拿到「已被前面的用例提示过」的假绿。
 */
beforeEach(() => {
  _resetUnsafeEndpointNoticeForTests_ACU();
  resetUiSurfaceRegistryForTests_ACU();
});

/** 断言被拒并返回错误文案。 */
function rejectionOf(endpoint: string, allowUnsafe = false): string {
  try {
    assertSafeHttpEndpoint_ACU(endpoint, { allowUnsafe });
  } catch (e: any) {
    return String(e?.message || '');
  }
  throw new Error(`预期端点「${endpoint}」被拒，实际通过（allowUnsafe=${allowUnsafe}）`);
}

/** 断言放行（不抛错）。 */
function expectAccepted(endpoint: string, allowUnsafe = false): void {
  expect(() => assertSafeHttpEndpoint_ACU(endpoint, { allowUnsafe })).not.toThrow();
}

describe('assertSafeHttpEndpoint_ACU — 默认路径（开关关闭，行为与文案不得变化）', () => {
  it('公网 https 放行', () => {
    expectAccepted('https://api.openai.com/v1');
    expectAccepted('https://example.com:8443/v1');
  });

  it('localhost 的 http 放行（127.0.0.1 / ::1 / localhost 三种写法）', () => {
    expectAccepted('http://localhost:1234/v1');
    expectAccepted('http://127.0.0.1:1234/v1');
    expectAccepted('http://[::1]:1234/v1');
  });

  it('远程 http 被拒，文案与既有一致', () => {
    expect(rejectionOf('http://api.test')).toContain('仅允许 localhost');
  });

  it('https 私网/环回被拒，文案与既有一致', () => {
    for (const endpoint of [
      'https://192.168.1.10/v1',
      'https://10.0.0.5/v1',
      'https://172.16.3.4/v1',
      'https://127.0.0.2/v1',
    ]) {
      expect(rejectionOf(endpoint)).toContain('私网/环回/链路本地');
    }
  });

  it('非 http(s) 协议被拒（具名 scheme 一律拒绝）', () => {
    expect(rejectionOf('ftp://example.com')).toContain('不支持的协议');
    expect(rejectionOf('file:///etc/passwd')).toContain('不支持的协议');
  });

  it('协议相对 URL 与反斜杠被拒', () => {
    expect(rejectionOf('//evil.com/v1')).toContain('协议相对');
    expect(rejectionOf('https:\\evil.com')).toContain('反斜杠');
  });

  it('缺省 options 与显式 allowUnsafe:false 等价', () => {
    expect(() => assertSafeHttpEndpoint_ACU('https://api.openai.com/v1')).not.toThrow();
    expect(() => assertSafeHttpEndpoint_ACU('http://api.test')).toThrow();
    expect(() => assertSafeHttpEndpoint_ACU('http://api.test', {})).toThrow();
    expect(() => assertSafeHttpEndpoint_ACU('http://api.test', { allowUnsafe: false })).toThrow();
  });
});

describe('assertSafeHttpEndpoint_ACU — allowUnsafe 开启：放行面', () => {
  it('http 远程主机放行', () => {
    expectAccepted('http://api.test/v1', true);
    expectAccepted('http://192.168.1.10:1234/v1', true);
  });

  it('私网 IPv4 各段放行', () => {
    for (const endpoint of [
      'http://10.0.0.5:8080/v1',
      'http://172.16.3.4/v1',
      'http://172.31.255.254/v1',
      'http://192.168.1.10/v1',
    ]) {
      expectAccepted(endpoint, true);
    }
  });

  it('环回地址放行（含非规范写法）', () => {
    expectAccepted('http://127.0.0.1:1234/v1', true);
    expectAccepted('http://127.0.0.2/v1', true);
    expectAccepted('http://127.1/v1', true); // 非规范两段写法，inet_aton 语义还原为 127.0.0.1
  });

  it('IPv6 私网（ULA fc00::/7）放行', () => {
    expectAccepted('http://[fd00::1]:1234/v1', true);
    expectAccepted('http://[fc00::1]/v1', true);
  });

  it('自签名证书场景：https 私网同样放行（放行面不区分协议，私网两者都开）', () => {
    expectAccepted('https://192.168.1.10/v1', true);
  });
});

describe('assertSafeHttpEndpoint_ACU — allowUnsafe 开启：永久封禁面（不因开关放行）', () => {
  it('云元数据 169.254.169.254 被拒（本开关最重要的负面用例）', () => {
    expect(rejectionOf('http://169.254.169.254/latest/meta-data/', true)).toContain('169.254.169.254');
    expect(rejectionOf('https://169.254.169.254/latest/meta-data/', true)).toContain('169.254.169.254');
    // 非规范写法也不能绕过（十进制 / 十六进制 / 两段）
    expect(rejectionOf('http://2852039166/latest/meta-data/', true)).toContain('169.254');
    expect(rejectionOf('http://0xa9fea9fe/latest/meta-data/', true)).toContain('169.254');
    expect(rejectionOf('http://169.254.43518/v1', true)).toContain('169.254');
  });

  it('整个链路本地网段 169.254/16 被拒（不止 .169.254 一个地址）', () => {
    expect(rejectionOf('http://169.254.1.1/v1', true)).toContain('169.254');
    expect(rejectionOf('http://169.254.255.255/v1', true)).toContain('169.254');
  });

  it('IPv6 链路本地 fe80::/10 被拒', () => {
    expect(rejectionOf('http://[fe80::1]:1234/v1', true)).toContain('链路本地');
    expect(rejectionOf('http://[febf::1]/v1', true)).toContain('链路本地');
  });

  it('未指定地址被拒（0.0.0.0 与 ::）', () => {
    expect(rejectionOf('http://0.0.0.0:1234/v1', true)).toContain('链路本地');
    expect(rejectionOf('http://[::]:1234/v1', true)).toContain('链路本地');
  });

  it('组播与保留段被拒（224/4、240/4、255.255.255.255、IPv6 ff00::/8）', () => {
    expect(rejectionOf('http://224.0.0.1/v1', true)).toContain('链路本地');
    expect(rejectionOf('http://240.0.0.1/v1', true)).toContain('链路本地');
    expect(rejectionOf('http://255.255.255.255/v1', true)).toContain('链路本地');
    expect(rejectionOf('http://[ff02::1]:1234/v1', true)).toContain('链路本地');
  });

  it('非 http(s) 协议在开关开启时仍被拒（开关只放宽地址，不放宽协议）', () => {
    expect(rejectionOf('ftp://192.168.1.10/v1', true)).toContain('不支持的协议');
    expect(rejectionOf('//192.168.1.10/v1', true)).toContain('协议相对');
  });

  it('云元数据**主机名**被拒（本门禁不做 DNS，按名封禁，否则「域名放行」就是旁路）', () => {
    expect(rejectionOf('http://metadata.google.internal/computeMetadata/v1/', true)).toContain('不会因开启');
    expect(rejectionOf('https://metadata.goog/v1', true)).toContain('不会因开启');
    expect(rejectionOf('http://instance-data/latest/meta-data/', true)).toContain('不会因开启');
  });

  it('阿里云元数据服务地址 100.100.100.200 被拒（其余 100.64/10 不在封禁面内）', () => {
    expect(rejectionOf('http://100.100.100.200/latest/meta-data/', true)).toContain('不会因开启');
  });

  it('域名一律放行（不做 DNS 解析，由调用方网络栈判定）', () => {
    // 域名解析后可能指向内网，但那属于调用方/DNS 层的职责；本门禁只判字面地址与已知元数据名。
    expectAccepted('http://my-nas.local:1234/v1', true);
    expectAccepted('http://localhost:1234/v1', true);
  });
});

describe('assertSafeHttpEndpoint_ACU — 「因开关放行」的可见化提示', () => {
  function captureToasts(): any[] {
    const toasts: any[] = [];
    // 每个用例从「未提示过」开始：去重状态是模块级的，不重置会拿到假绿。
    _resetUnsafeEndpointNoticeForTests_ACU();
    resetUiSurfaceRegistryForTests_ACU();
    registerUiSurface_ACU({
      openSettings: async () => false,
      openVisualizer: async () => false,
      refreshVisualizer: async () => {},
      showToast: (payload: any) => toasts.push(payload),
    });
    return toasts;
  }

  /** 在「warn 采集开启 + console.warn 被拦截」下执行：warn 采集默认关闭，不开则 warn 断言是空断言。 */
  function withWarnCapture<T>(fn: (warnSpy: any) => T): T {
    const warnWasEnabled = isWarnLogEnabled();
    setWarnLogEnabled(true);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      return fn(warnSpy);
    } finally {
      warnSpy.mockRestore();
      setWarnLogEnabled(warnWasEnabled);
    }
  }

  it('开关确实放行时：warn 按主机去重、toast 每会话只弹一次', () => {
    const toasts = captureToasts();

    withWarnCapture((warnSpy) => {
      assertSafeHttpEndpoint_ACU('http://192.168.1.10:1234/v1', { allowUnsafe: true });
      assertSafeHttpEndpoint_ACU('http://192.168.1.10:1234/v1', { allowUnsafe: true }); // 同主机：不重复
      assertSafeHttpEndpoint_ACU('http://10.0.0.5:8080/v1', { allowUnsafe: true });     // 另一主机：再记一条

      // warn 按主机去重：2 个不同主机 → 2 条；同主机重复调用不增
      expect(warnSpy).toHaveBeenCalledTimes(2);
      expect(warnSpy.mock.calls[0].join(' ')).toContain('http://192.168.1.10:1234');
    });

    // toast 每会话一次：三条调用只弹一次，且带首个触发者的 origin（不含路径）
    expect(toasts).toHaveLength(1);
    expect(toasts[0].kind).toBe('warning');
    expect(toasts[0].text).toContain('http://192.168.1.10:1234');
    expect(toasts[0].text).not.toContain('/v1');
  });

  it('不因开关开着就提示：本来就被放行的端点（公网 https、http://localhost）不弹', () => {
    const toasts = captureToasts();

    withWarnCapture((warnSpy) => {
      assertSafeHttpEndpoint_ACU('https://api.openai.com/v1', { allowUnsafe: true });
      assertSafeHttpEndpoint_ACU('http://localhost:1234/v1', { allowUnsafe: true });
      assertSafeHttpEndpoint_ACU('http://127.0.0.1:1234/v1', { allowUnsafe: true });

      expect(warnSpy).not.toHaveBeenCalled();
    });

    expect(toasts).toHaveLength(0);
  });

  it('默认关闭时零副作用：被拒的端点不弹提示（提示只属于「真的放行」）', () => {
    const toasts = captureToasts();
    expect(() => assertSafeHttpEndpoint_ACU('http://192.168.1.10:1234/v1')).toThrow();
    expect(toasts).toHaveLength(0);
  });
});