import { ref, type Ref } from "vue";
import { settings_ACU } from "../../service/runtime/state-manager";
import { saveSettings_ACU } from "../../service/settings/settings-service";

/**
 * useApiEndpointSecuritySettings — 「允许不安全端点」全局开关的读写。
 *
 * 语义（单一总开关，默认关闭）：
 * - 关闭（默认）：门禁与既有行为逐字节一致 —— http:// 仅允许 localhost，私网/环回一律拒。
 * - 开启：放行 http:// 远程主机与私网/环回 IP（局域网自建服务、自签名证书）。
 * - **与开关无关的永久封禁**：链路本地（含云元数据 169.254.169.254）、未指定（0.0.0.0 / ::）、
 *   组播与保留段（IPv4 224/4 与 240/4、IPv6 ff00::/8）。见 `shared/utils.ts` 的
 *   `isAlwaysBlockedHost_ACU` —— 这些地址只与云环境凭据泄漏有关，与用户自建服务无关。
 *
 * 读取侧：service 层经 `allowUnsafeApiEndpointsEnabled_ACU()`（`service/settings/settings-readers.ts`）
 * 读取后注入各调用点（主 API 请求体、模型列表探活、embedding、rerank）；data 层网关不反向
 * 依赖 service 设置，开关经请求对象传入。
 *
 * 写入侧只此一处 UI。settings_ACU 是普通对象（非响应式），故用本地 ref 承载 UI 状态并在
 * 写入时同步——与既有面板（AcuToggle + 父级 ref）同一模式。
 */
export function useApiEndpointSecuritySettings(): {
  allowUnsafeApiEndpoints: Ref<boolean>;
  setAllowUnsafeApiEndpoints: (value: boolean) => void;
} {
  const allowUnsafeApiEndpoints = ref(settings_ACU?.allowUnsafeApiEndpoints === true);

  function setAllowUnsafeApiEndpoints(value: boolean): void {
    allowUnsafeApiEndpoints.value = value === true;
    settings_ACU.allowUnsafeApiEndpoints = value === true;
    saveSettings_ACU();
  }

  return { allowUnsafeApiEndpoints, setAllowUnsafeApiEndpoints };
}