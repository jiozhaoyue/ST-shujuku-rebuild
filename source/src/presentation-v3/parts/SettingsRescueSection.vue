<template>
  <UbSection
    :id="id"
    title="配置副本恢复"
    description="找回未落盘的配置。"
    icon="fa-solid fa-rotate-recovery"
  >
    <template #actions>
      <UbButton size="sm" variant="ghost" icon="fa-solid fa-rotate" :busy="loading" @click="refresh">刷新</UbButton>
    </template>

    <p v-if="!loading && !rows.length" class="ub-sr__empty">{{ ready ? '暂无待恢复的配置副本。' : '设置尚未就绪。' }}</p>

    <div v-if="rows.length" class="ub-sr__list" data-sr-list>
      <div v-for="row in rows" :key="row.key" class="ub-sr__item" data-sr-item>
        <div class="ub-sr__meta">
          <span class="ub-sr__time">{{ row.time }}</span>
          <span class="ub-sr__count">{{ row.keyCount }} 个键</span>
        </div>
        <div class="ub-sr__actions">
          <UbButton size="sm" variant="soft" :busy="busyKey === row.key" @click="onRestore(row)">恢复</UbButton>
          <UbButton size="sm" variant="ghost" :busy="busyKey === row.key" @click="onDecline(row)">忽略</UbButton>
        </div>
      </div>
    </div>
  </UbSection>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useToastStore } from '../../presentation-v2/stores/toast-store';
import {
    declineSettingsRescue_ACU,
    findSettingsRescueCandidate_ACU,
    restoreSettingsRescue_ACU,
    type SettingsRescueCandidate_ACU,
} from '../../service/settings/settings-rescue-service';
import type { StoredSettingsRescue_ACU } from '../../data/storage/settings-rescue';
import UbButton from '../ui/UbButton.vue';
import UbSection from '../ui/UbSection.vue';

withDefaults(defineProps<{ id?: string }>(), { id: undefined });

type Row = { key: string; time: string; keyCount: number; stored: StoredSettingsRescue_ACU };

const toast = useToastStore();
const loading = ref(false);
const busyKey = ref<string | null>(null);
const ready = ref(true);
const candidate = ref<SettingsRescueCandidate_ACU | null>(null);

const rows = computed<Row[]>(() => {
  const current = candidate.value;
  if (!current) return [];
  return current.pending.map((stored, index) => ({
    key: `${stored.backend}:${stored.record.writtenAt}:${index}`,
    time: formatTime_ACU(stored.record.savedAt),
    keyCount: Object.keys(stored.record.backup.entries).length,
    stored,
  }));
});

function formatTime_ACU(timestamp: number): string {
  if (!Number.isFinite(timestamp)) return '';
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

async function refresh(): Promise<void> {
  loading.value = true;
  try {
    const lookup = await findSettingsRescueCandidate_ACU();
    ready.value = lookup.ready;
    candidate.value = lookup.candidate;
  } finally {
    loading.value = false;
  }
}

async function onRestore(row: Row): Promise<void> {
  if (busyKey.value) return;
  busyKey.value = row.key;
  try {
    const result = restoreSettingsRescue_ACU({ latest: row.stored, pending: [row.stored] });
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    await refresh();
  } finally {
    busyKey.value = null;
  }
}

async function onDecline(row: Row): Promise<void> {
  if (busyKey.value) return;
  busyKey.value = row.key;
  try {
    const result = await declineSettingsRescue_ACU({ latest: row.stored, pending: [row.stored] });
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    await refresh();
  } finally {
    busyKey.value = null;
  }
}

onMounted(refresh);
</script>

<style scoped>
.ub-sr__empty {
  padding: var(--ub-s4);
  color: var(--ub-text-3);
  font-size: var(--ub-fs-xs);
  text-align: center;
}

.ub-sr__list {
  display: flex;
  flex-direction: column;
  gap: var(--ub-s2);
}

.ub-sr__item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--ub-s3);
  padding: var(--ub-s3) var(--ub-s4);
  border-radius: var(--ub-r-control);
  background: var(--ub-sunken);
  box-shadow: var(--ub-card-shadow);
}

.ub-sr__meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.ub-sr__time {
  color: var(--ub-text);
  font-size: var(--ub-fs-sm);
  font-variant-numeric: tabular-nums;
}

.ub-sr__count {
  color: var(--ub-text-3);
  font-size: var(--ub-fs-xs);
}

.ub-sr__actions {
  display: flex;
  flex: 0 0 auto;
  gap: var(--ub-s2);
}
</style>
