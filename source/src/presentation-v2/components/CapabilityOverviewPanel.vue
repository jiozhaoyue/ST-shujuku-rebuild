<template>
  <AcuPanel
    id="developer-capability-overview-panel"
    class="acu-v2-capability-overview"
    title="环境与能力总览"
    description="把「这份产物跑在哪个宿主上、它能做什么、状态存在哪几个通道」摊开在一处：环境事实现读现显，接口清单来自插件自身的 API 注册表，持久化面来自数据层的字段常量——都是单一事实源，不是抄来的说明。整块可一键复制成脱敏文本贴给 AI，它据此就知道有哪些接口可调、数据存在哪，不用猜。"
  >
    <template #actions>
      <AcuBadge variant="accent">可调用 {{ apiLiveTotal }} 个方法</AcuBadge>
      <AcuBadge v-if="apiGatedCount > 0" variant="warning">
        {{ apiGatedCount }} 个当前被门禁隐藏
      </AcuBadge>
      <AcuBadge :variant="isTauriHost ? 'warning' : 'neutral'">
        宿主 {{ hostKindLabel }}
      </AcuBadge>
    </template>

    <div class="acu-v2-capability-overview__actions">
      <AcuButton @click="flow.copyOverview()">
        <i class="fa-solid fa-clipboard"></i>
        复制总览给 AI
      </AcuButton>
    </div>

    <section class="acu-v2-capability-overview__section">
      <h4 class="acu-v2-capability-overview__section-title">环境</h4>
      <AcuStatsList :items="environmentItems" mono />
    </section>

    <section class="acu-v2-capability-overview__section">
      <h4 class="acu-v2-capability-overview__section-title">
        可调用的公开 API（window.AutoCardUpdaterAPI）
      </h4>
      <AcuDisclosureGroup
        v-for="group in flow.apiGroups.value"
        :key="group.name"
        :label="group.name"
        :meta="`${group.methods.length} 个方法`"
        :expanded="isOpen(`api:${group.name}`)"
        @toggle="toggle(`api:${group.name}`)"
      >
        <div class="acu-v2-capability-overview__chips">
          <code v-for="method in group.methods" :key="method" class="acu-v2-capability-overview__chip">
            {{ method }}
          </code>
        </div>
      </AcuDisclosureGroup>
    </section>

    <section class="acu-v2-capability-overview__section">
      <h4 class="acu-v2-capability-overview__section-title">状态持久化面</h4>
      <p class="acu-v2-capability-overview__note">
        本插件的状态只落这四类通道。改数据层之前先确认新状态属于哪一类——未归类的新通道就是审查不通过。
      </p>
      <AcuDisclosureGroup
        v-for="channel in flow.storageChannels.value"
        :key="channel.name"
        :label="channel.name"
        :meta="`${channel.fields.length} 个字段/键`"
        :expanded="isOpen(`store:${channel.name}`)"
        @toggle="toggle(`store:${channel.name}`)"
      >
        <p class="acu-v2-capability-overview__note">{{ channel.detail }}</p>
        <div class="acu-v2-capability-overview__chips">
          <code v-for="field in channel.fields" :key="field" class="acu-v2-capability-overview__chip">
            {{ field }}
          </code>
        </div>
      </AcuDisclosureGroup>
    </section>
  </AcuPanel>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import AcuBadge from './_lib/AcuBadge.vue';
import AcuButton from './_lib/AcuButton.vue';
import AcuDisclosureGroup from './_lib/AcuDisclosureGroup.vue';
import AcuPanel from './_lib/AcuPanel.vue';
import AcuStatsList, { type AcuStatsItem } from './_lib/AcuStatsList.vue';
import { useCapabilityOverview } from '../composables/useCapabilityOverview';

const flow = useCapabilityOverview();

/** 展开态：默认全收起，避免一次把上百个方法名铺满屏幕（有限屏幕优先）。 */
const expanded = ref<Set<string>>(new Set());
function isOpen(key: string): boolean {
  return expanded.value.has(key);
}
function toggle(key: string): void {
  const next = new Set(expanded.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  expanded.value = next;
}

const environmentItems = computed<AcuStatsItem[]>(() =>
  flow.environment.value.map(row => ({ label: row.label, value: row.value })));

/** 宿主名直接取「环境」首行（其顺序由 composable 的单一事实源决定），不另开一条取值路径。 */
const hostKindLabel = computed(() => flow.environment.value[0]?.value || '—');
const isTauriHost = computed(() => hostKindLabel.value === 'tauritavern');
/**
 * composable 的返回值挂在 `flow` 上，模板只认**顶层绑定**——这里显式提到顶层。
 * （踩过：直接在模板里写裸名字会导致渲染报错 / 静默渲染成空。）
 */
const apiLiveTotal = computed(() => flow.apiLiveTotal.value);
const apiGatedCount = computed(() => flow.apiGatedCount.value);
</script>

<style scoped>
.acu-v2-capability-overview__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--acu-space-2, 8px);
  margin-bottom: var(--acu-space-3, 12px);
}

.acu-v2-capability-overview__section {
  margin-top: var(--acu-space-3, 12px);
  min-width: 0;
}

.acu-v2-capability-overview__section-title {
  margin: 0 0 var(--acu-space-150, 6px);
  color: var(--acu-text-2);
  font-size: var(--acu-font-size-body, 12px);
  font-weight: 600;
}

.acu-v2-capability-overview__note {
  margin: var(--acu-space-100, 4px) 0 var(--acu-space-150, 6px);
  color: var(--acu-text-3);
  font-size: var(--acu-font-size-caption, 11px);
  line-height: var(--acu-line-height-caption, 1.5);
}

.acu-v2-capability-overview__chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--acu-space-100, 4px);
  margin-bottom: var(--acu-space-150, 6px);
}

.acu-v2-capability-overview__chip {
  font-family: var(--acu-font-mono);
  font-size: var(--acu-font-size-caption, 11px);
  color: var(--acu-text-1);
  background: var(--acu-bg-2);
  padding: 1px var(--acu-space-100, 4px);
  border-radius: var(--acu-radius-sm);
  word-break: break-all;
}
</style>
