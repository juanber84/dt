<script setup>
import { onMounted, ref } from 'vue';
import { Copy, KeyRound, Trash2 } from '@lucide/vue';
import { useConfirm } from '../../composables/useConfirm.js';
import { useToast } from '../../composables/useToast.js';
import { createToken, listTokens, revokeToken } from '../../services/twin.js';
import { fmtRelativeTime } from '../../lib/format.js';

const { ask } = useConfirm();
const toast = useToast();
const tokens = ref(null);
const name = ref('');
const created = ref(null); // { name, token }: se enseña una sola vez
const busy = ref(false);
const endpoint = `${location.origin}/api/mcp`;

async function load() {
  tokens.value = await listTokens().catch(() => []);
}
onMounted(load);

async function create() {
  busy.value = true;
  try {
    const result = await createToken(name.value.trim() || 'Mi IA');
    created.value = { name: result.name, token: result.token };
    name.value = '';
    await load();
  } catch (err) {
    toast.show(`No se ha podido crear (${err.message})`, 'critical');
  } finally {
    busy.value = false;
  }
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast.show('Copiado');
  } catch {
    toast.show('No se ha podido copiar: selecciónalo a mano', 'critical');
  }
}

async function revoke(token) {
  const ok = await ask({
    title: `¿Revocar «${token.name}»?`,
    message: 'La IA que lo use dejará de poder leer tus datos.',
    confirmLabel: 'Revocar',
    danger: true,
  });
  if (!ok) return;
  await revokeToken(token.id).catch(() => {});
  await load();
}
</script>

<template>
  <section>
    <h2 class="sub">Acceso para tu IA (MCP)</h2>
    <p class="secondary sub-desc">
      Conecta Claude u otra IA a tus datos (solo lectura) con un token personal.
      <a href="/docs/ia/mcp.html" class="link">Cómo conectarla</a>
    </p>

    <div v-if="created" class="card created">
      <strong>Token para «{{ created.name }}»</strong>
      <p class="muted">Cópialo ahora: no se vuelve a enseñar.</p>
      <div class="secret">
        <code>{{ created.token }}</code>
        <button class="btn btn-sm" @click="copy(created.token)">
          <Copy class="icon icon-sm" /> Copiar
        </button>
      </div>
      <p class="muted">
        Servidor: <code>{{ endpoint }}</code>
      </p>
      <button class="btn btn-ghost btn-sm" @click="created = null">Hecho</button>
    </div>

    <ul v-if="tokens?.length" class="card list">
      <li v-for="t in tokens" :key="t.id">
        <KeyRound class="icon icon-sm" />
        <span class="text">
          <strong>{{ t.name }}</strong>
          <span class="muted">{{
            t.lastUsedAt ? `usado ${fmtRelativeTime(t.lastUsedAt)}` : 'sin usar todavía'
          }}</span>
        </span>
        <button
          class="btn btn-ghost btn-icon btn-sm"
          :aria-label="`Revocar ${t.name}`"
          title="Revocar"
          @click="revoke(t)"
        >
          <Trash2 class="icon icon-sm" />
        </button>
      </li>
    </ul>

    <form class="new" @submit.prevent="create">
      <input v-model="name" class="input" placeholder="Nombre, p. ej. Claude Code" maxlength="80" />
      <button class="btn" type="submit" :disabled="busy">Crear token</button>
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

.link {
  text-decoration: underline;
}

.created {
  display: grid;
  gap: 8px;
  padding: 14px 16px;
  margin-bottom: 12px;
  font-size: 13px;
}

.secret {
  display: flex;
  align-items: center;
  gap: 8px;
}

.secret code {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
  padding: 8px;
  border-radius: 6px;
  background: var(--surface-2);
  font-size: 12px;
}

.list {
  margin: 0 0 12px;
  padding: 0;
  list-style: none;
}

.list li {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  font-size: 13px;
}

.list li + li {
  border-top: 1px solid var(--border);
}

.text {
  display: grid;
  flex: 1;
  min-width: 0;
}

.new {
  display: flex;
  gap: 8px;
}

.new .input {
  flex: 1;
  max-width: 320px;
}
</style>
