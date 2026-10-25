<template>
  <AcuPanel
    id="developer-diagnostic-bundle-panel"
    class="acu-v2-diagnostic-bundle"
    :title="copy.title"
    :description="copy.description"
  >
    <template #actions>
      <AcuBadge variant="neutral">{{ copy.badge }}</AcuBadge>
    </template>

    <div class="acu-v2-diagnostic-bundle__actions">
      <AcuButton @click="bundle.exportJson()">
        <i class="fa-solid fa-download"></i>
        {{ copy.exportJson }}
      </AcuButton>
      <AcuButton @click="bundle.copyText()">
        <i class="fa-solid fa-clipboard"></i>
        {{ copy.copyText }}
      </AcuButton>
    </div>

    <AcuInfoBanner tone="tip" class="acu-v2-diagnostic-bundle__howto">
      {{ copy.howto }}
    </AcuInfoBanner>
  </AcuPanel>
</template>

<script setup lang="ts">
import AcuBadge from "./_lib/AcuBadge.vue";
import AcuButton from "./_lib/AcuButton.vue";
import AcuInfoBanner from "./_lib/AcuInfoBanner.vue";
import AcuPanel from "./_lib/AcuPanel.vue";
import { developerCopy } from "../copy/developer-copy";
import { useDiagnosticBundle } from "../composables/useDiagnosticBundle";

const copy = developerCopy.diagnosticBundle;
const bundle = useDiagnosticBundle();
</script>

<style scoped>
.acu-v2-diagnostic-bundle__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 12px;
}
</style>
