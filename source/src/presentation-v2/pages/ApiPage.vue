<template>
  <section class="acu-v2-api-page">
    <AcuPanelGrid class="acu-v2-api-page__grid">
      <ApiConfigPanel />

      <AcuPanel
        title="端点安全"
        description="默认只放行公网 https 与 localhost；局域网自建服务、自签名证书需要开启下面的开关。"
        description-tone="warning"
      >
        <div class="acu-v2-api-page__security">
          <AcuToggle
            :model-value="allowUnsafeApiEndpoints"
            label="允许不安全端点"
            description="开启后放行 http:// 远程主机与私网/环回 IP（例如 http://192.168.1.10:1234）。明文传输与自签名证书的风险由你自行承担。链路本地地址（含云元数据 169.254.169.254）、未指定地址、组播与保留段在任何情况下都不会放行。作用于全部经本库发出的调用：主 API、模型列表探活、embedding 与 rerank 端点。"
            @update:model-value="setAllowUnsafeApiEndpoints"
          />
          <AcuInfoBanner
            tone="warning"
            text="仅当你确认该地址属于你自己的机器或可信局域网时开启。开启后请求头（含 API 密钥）会以明文发往该端点。"
          />
        </div>
      </AcuPanel>

      <div class="acu-v2-api-page__spacer" aria-hidden="true"></div>
    </AcuPanelGrid>
  </section>
</template>

<script setup lang="ts">
import AcuInfoBanner from "../components/_lib/AcuInfoBanner.vue";
import AcuPanel from "../components/_lib/AcuPanel.vue";
import AcuPanelGrid from "../components/_lib/AcuPanelGrid.vue";
import AcuToggle from "../components/_lib/AcuToggle.vue";
import ApiConfigPanel from "../components/ApiConfigPanel.vue";
import { useApiEndpointSecuritySettings } from "../composables/useApiEndpointSecuritySettings";

const { allowUnsafeApiEndpoints, setAllowUnsafeApiEndpoints } = useApiEndpointSecuritySettings();
</script>

<style scoped>
.acu-v2-api-page {
  min-height: 100%;
  min-width: 0;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.acu-v2-api-page__security {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}

.acu-v2-api-page__spacer {
  min-width: 0;
}

@media (max-width: 860px) {
  .acu-v2-api-page {
    padding: 14px;
  }

  .acu-v2-api-page__spacer {
    display: none;
  }
}
</style>
