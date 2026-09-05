/**
 * presentation-v2/composables/useDifferentialInjectionSettings.ts
 * 差量注入设置的 UI 绑定：开关 + 热/冷表名单（CSV 文本）。
 * 直接绑定 settings_ACU 对应键，变更即时 saveSettings_ACU（与其他面板一致）。
 */

import { computed } from "vue";
import { settings_ACU } from "../../service/runtime/state-manager";
import { saveSettings_ACU } from "../../service/settings/settings-service";

export function useDifferentialInjectionSettings() {
  const enabled = computed<boolean>({
    get: () => settings_ACU.differentialInjectionEnabled === true,
    set: (value: boolean) => {
      settings_ACU.differentialInjectionEnabled = value === true;
      saveSettings_ACU();
    },
  });

  const hotSheets = computed<string>({
    get: () => String(settings_ACU.differentialHotSheets ?? ""),
    set: (value: string) => {
      settings_ACU.differentialHotSheets = String(value ?? "");
      saveSettings_ACU();
    },
  });

  const coldSheets = computed<string>({
    get: () => String(settings_ACU.differentialColdSheets ?? ""),
    set: (value: string) => {
      settings_ACU.differentialColdSheets = String(value ?? "");
      saveSettings_ACU();
    },
  });

  return { enabled, hotSheets, coldSheets };
}
