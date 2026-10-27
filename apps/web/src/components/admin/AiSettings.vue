<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { ExternalLink, KeyRound, Sparkles } from '@lucide/vue';
import Meter from '../ui/Meter.vue';
import PasswordInput from '../ui/PasswordInput.vue';
import { useConfirm } from '../../composables/useConfirm.js';
import { useToast } from '../../composables/useToast.js';
import { fetchMyAi, fmtMoney, removeAiProvider, saveAiProvider } from '../../services/ai.js';
import { fmtRelativeTime } from '../../lib/format.js';

/**
 * Cuenta → IA: lo gastado hoy frente al límite (con la IA de la app) o la clave propia de un
 * proveedor de la lista (sin límite).
 */
const toast = useToast();
const { ask } = useConfirm();
const info = ref(null);
const editing = ref(false);
const saving = ref(false);
const form = reactive({ provider: 'deepseek', model: '', apiKey: '' });

async function load() {
  info.value = await fetchMyAi().catch(() => null);
}
onMounted(load);

const providers = computed(() => info.value?.providers ?? []);
const providerOf = (id) => providers.value.find((p) => p.id === id);
const chosen = computed(() => providerOf(form.provider));
// Mismo proveedor que el guardado: la clave puede quedarse vacía (se usa la de antes)
const keepsKey = computed(() => info.value?.own?.provider === form.provider);
const valid = computed(() => form.model.trim() && (form.apiKey.trim() || keepsKey.value));

const usage = computed(() => {
  const i = info.value;
  if (!i || i.own) return null;
  if (i.limitUsd == null) return { unlimited: true, text: `Hoy: ${fmtMoney(i.spentTodayUsd)}` };
  const over = i.spentTodayUsd >= i.limitUsd;
  return {
    over,
    pct: i.limitUsd > 0 ? Math.min(100, Math.round((i.spentTodayUsd / i.limitUsd) * 100)) : 100,
    text: over
      ? 'Has usado toda la IA de hoy: vuelve mañana o pon tu propia clave.'
      : 'Se reinicia cada día a medianoche.',
  };
});

function edit() {
  const own = info.value?.own;
  Object.assign(form, {
    provider: own?.provider ?? 'deepseek',
    model: own?.model ?? '',
    apiKey: '',
  });
  editing.value = true;
}

async function save() {
  saving.value = true;
  try {
    info.value = await saveAiProvider({
      provider: form.provider,
      model: form.model.trim(),
      ...(form.apiKey.trim() && { apiKey: form.apiKey.trim() }),
    });
    editing.value = false;
    toast.show('Listo: la IA va ahora con tu clave', 'good');
  } catch (err) {
    toast.show(err.message, 'critical');
  } finally {
    saving.value = false;
  }
}

async function remove() {
  const ok = await ask({
    title: '¿Quitar tu clave?',
    message: 'Se borra de aquí y vuelves a la IA de la app, con su límite diario.',
    confirmLabel: 'Quitar',
    danger: true,
  });
  if (!ok) return;
  try {
    info.value = await removeAiProvider();
  } catch (err) {
    toast.show(err.message, 'critical');
  }
}
</script>

<template>
  <section v-if="info" class="ai">
    <h2 class="sub">IA</h2>
    <p class="secondary sub-desc">
      El coach, las comidas, los informes médicos y el comentario del informe de la mañana usan IA.
      La de la app tiene un gasto máximo al día; con tu propia clave, no hay límite y lo pagas tú.
    </p>

    <div v-if="info.own" class="card status">
      <KeyRound class="icon" />
      <div class="text">
        <strong
          >{{ providerOf(info.own.provider)?.label ?? info.own.provider }} ·
          {{ info.own.model }}</strong
        >
        <span class="muted"
          >Tu clave {{ info.own.keyHint }} · guardada
          {{ fmtRelativeTime(info.own.updatedAt) }}</span
        >
      </div>
      <div class="actions">
        <button class="btn btn-sm" @click="edit">Cambiar</button>
        <button class="btn btn-ghost btn-sm" @click="remove">Quitar</button>
      </div>
    </div>

    <div v-else-if="usage" class="card status usage">
      <Sparkles class="icon" />
      <div class="text">
        <template v-if="usage.unlimited">
          <strong>IA de la app, sin límite</strong>
          <span class="muted">{{ usage.text }} (eres administrador)</span>
        </template>
        <template v-else>
          <strong>IA de hoy: {{ usage.pct }} %</strong>
          <Meter
            :value="info.spentTodayUsd"
            :max="info.limitUsd || 1"
            :color="usage.over ? 'var(--critical)' : 'var(--text)'"
          />
          <span :class="usage.over ? 'critical' : 'muted'">{{ usage.text }}</span>
        </template>
      </div>
    </div>

    <button v-if="!info.own && !editing" class="btn add" @click="edit">
      <KeyRound class="icon icon-sm" /> Usar mi propia clave
    </button>

    <form v-if="editing" class="card form" @submit.prevent="save">
      <p v-if="!info.canStoreKeys" class="critical">
        El servidor aún no puede guardar claves (falta TOKEN_ENCRYPTION_KEY).
      </p>
      <label class="field">
        <span>Proveedor</span>
        <select v-model="form.provider" class="input">
          <option v-for="p in providers" :key="p.id" :value="p.id">{{ p.label }}</option>
        </select>
      </label>
      <label class="field">
        <span>Modelo</span>
        <input
          v-model="form.model"
          class="input"
          :placeholder="chosen?.modelHint"
          autocapitalize="off"
          spellcheck="false"
          required
        />
      </label>
      <label class="field">
        <span>{{ keepsKey ? 'Clave (vacía: la que ya tienes)' : 'Clave de la API' }}</span>
        <PasswordInput
          v-model="form.apiKey"
          name="api-key"
          autocomplete="off"
          :required="!keepsKey"
        />
      </label>
      <a
        v-if="chosen?.keysUrl"
        class="keys muted"
        :href="chosen.keysUrl"
        target="_blank"
        rel="noopener"
      >
        Sacar una clave de {{ chosen.label }} <ExternalLink class="icon icon-sm" />
      </a>
      <p class="muted hint">
        Al guardar se prueba con una llamada mínima (modo JSON y herramientas, que es lo que usa la
        app). La clave se guarda cifrada y no se vuelve a enseñar. Para las fotos de comidas, el
        modelo tiene que admitir imágenes.
      </p>
      <div class="buttons">
        <button class="btn btn-ghost" type="button" :disabled="saving" @click="editing = false">
          Cancelar
        </button>
        <button class="btn btn-primary" type="submit" :disabled="saving || !valid">
          {{ saving ? 'Probando…' : 'Probar y guardar' }}
        </button>
      </div>
    </form>
  </section>
</template>

<style scoped>
.sub {
  margin: 32px 0 4px;
  font-size: 15px;
}

.sub-desc {
  margin-bottom: 12px;
  font-size: 13px;
}

.status {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
}

.usage {
  align-items: flex-start;
}

.text {
  display: grid;
  gap: 6px;
  flex: 1;
  min-width: 0;
  font-size: 13px;
}

.text strong {
  font-size: 14px;
  overflow-wrap: anywhere;
}

.actions {
  display: flex;
  gap: 6px;
  flex: none;
}

.add {
  gap: 8px;
  margin-top: 12px;
}

.form {
  display: grid;
  gap: 12px;
  margin-top: 12px;
  padding: 16px;
}

.keys {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
}

.hint {
  margin: 0;
  font-size: 12px;
}

.buttons {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.critical {
  color: var(--critical-text);
}

@media (max-width: 860px) {
  .status:not(.usage) {
    flex-wrap: wrap;
  }

  .actions {
    width: 100%;
    justify-content: flex-end;
  }
}
</style>
