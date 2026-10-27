<script setup>
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ArrowRight, CircleAlert, LoaderCircle, Lock, ScanFace } from '@lucide/vue';
import LoginGallery from '../components/login/LoginGallery.vue';
import BrandMark from '../components/ui/BrandMark.vue';
import PasswordInput from '../components/ui/PasswordInput.vue';
import { signIn, signInWithPasskey } from '../composables/useAuth.js';
import { cancelled, passkeyHere, supportsPasskeys } from '../services/auth.js';
import { safeNext } from '../lib/navigation.js';

const route = useRoute();
const router = useRouter();

const username = ref('');
const password = ref('');
const remember = ref(true);
const busy = ref(false);
const error = ref(null);

// v-focus o v-focus="false" (con Face ID primero no se abre el teclado)
const vFocus = { mounted: (el, { value }) => value !== false && el.focus() };

const passkeys = supportsPasskeys();
// Si ya lo usas en este dispositivo, Face ID va primero y la contraseña queda como alternativa
const passkeyFirst = passkeys && passkeyHere();
const passkeyBusy = ref(false);

async function submitPasskey() {
  passkeyBusy.value = true;
  error.value = null;
  try {
    await signInWithPasskey();
    router.replace(safeNext(route.query.next) ?? { name: 'day' });
  } catch (err) {
    if (!cancelled(err)) {
      error.value =
        MESSAGES[err.code] ??
        (err.status ? err.message : 'No se ha podido entrar con Face ID. Usa tu contraseña.');
    }
  } finally {
    passkeyBusy.value = false;
  }
}

const MESSAGES = {
  INVALID_CREDENTIALS: 'Usuario o contraseña incorrectos.',
  TOO_MANY_REQUESTS: 'Demasiados intentos. Espera un poco y vuelve a probar.',
};

// Lo que alimenta al gemelo (con el color de su familia de datos)
const SOURCES = [
  { name: 'Apple Watch', color: '#3987e5' },
  { name: 'Garmin · intervals.icu', color: '#eb6834' },
  { name: 'Báscula', color: '#c3c2b7' },
  { name: 'Bot de comidas', color: '#1baf7a' },
];

async function submit() {
  if (!username.value.trim() || !password.value) {
    error.value = 'Escribe tu usuario y tu contraseña.';
    return;
  }
  busy.value = true;
  error.value = null;
  try {
    await signIn({ username: username.value, password: password.value, remember: remember.value });
    password.value = '';
    router.replace(safeNext(route.query.next) ?? { name: 'day' });
  } catch (err) {
    error.value =
      MESSAGES[err.code] ?? (err.status ? err.message : 'No se puede conectar con la API.');
    password.value = '';
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <!-- Siempre oscura: es la portada del gemelo, de noche como un reloj de pulsera -->
  <div class="login">
    <LoginGallery />

    <section class="hero">
      <span class="brand">
        <BrandMark :size="28" />
        <span>Twin<span class="soft">Me</span></span>
      </span>

      <div class="pitch">
        <h1>Tu cuerpo, <span class="accent">en un solo sitio</span>.</h1>
        <p>
          Cada noche, cada latido, cada entreno y cada comida, de todas tus fuentes a la vez y sin
          duplicados. Tu gemelo digital, en tu propio servidor.
        </p>
        <ul class="sources">
          <li v-for="s in SOURCES" :key="s.name">
            <span class="dot" :style="{ background: s.color }" />
            {{ s.name }}
          </li>
        </ul>
      </div>
    </section>

    <section class="panel">
      <div class="card">
        <h2>Hola de nuevo</h2>
        <p class="lead">Entra para ver cómo vas hoy.</p>

        <template v-if="passkeyFirst">
          <button
            class="btn submit passkey-first"
            type="button"
            :disabled="busy || passkeyBusy"
            @click="submitPasskey"
          >
            <LoaderCircle v-if="passkeyBusy" class="icon icon-sm spin" />
            <ScanFace v-else class="icon icon-sm" />
            Entrar con Face ID
          </button>
          <p v-if="error" class="error" role="alert">
            <CircleAlert class="icon icon-sm" />
            {{ error }}
          </p>
          <p class="or"><span>o con tu contraseña</span></p>
        </template>

        <form class="form" novalidate @submit.prevent="submit">
          <label class="field">
            <span>Usuario</span>
            <input
              v-model="username"
              v-focus="!passkeyFirst"
              class="input"
              type="text"
              name="username"
              autocomplete="username"
              autocapitalize="off"
              spellcheck="false"
              required
            />
          </label>

          <label class="field">
            <span>Contraseña</span>
            <PasswordInput v-model="password" />
          </label>

          <label class="remember">
            <input v-model="remember" type="checkbox" />
            <span>Mantener la sesión iniciada 30 días</span>
          </label>

          <p v-if="error && !passkeyFirst" class="error" role="alert">
            <CircleAlert class="icon icon-sm" />
            {{ error }}
          </p>

          <button
            class="btn submit"
            :class="{ secondary: passkeyFirst }"
            type="submit"
            :disabled="busy || passkeyBusy"
          >
            <template v-if="busy">
              <LoaderCircle class="icon icon-sm spin" />
              Entrando…
            </template>
            <template v-else>
              Entrar
              <ArrowRight class="icon icon-sm" />
            </template>
          </button>
        </form>

        <!-- Solo vale si ya lo activaste en Cuenta desde este dispositivo (o tu llavero de iCloud) -->
        <template v-if="passkeys && !passkeyFirst">
          <p class="or"><span>o</span></p>
          <button
            class="btn passkey"
            type="button"
            :disabled="busy || passkeyBusy"
            @click="submitPasskey"
          >
            <LoaderCircle v-if="passkeyBusy" class="icon icon-sm spin" />
            <ScanFace v-else class="icon icon-sm" />
            Entrar con Face ID
          </button>
        </template>
      </div>

      <footer class="foot">
        <Lock class="icon icon-sm" />
        Acceso privado. Tus datos no salen de tu servidor.
      </footer>
    </section>
  </div>
</template>

<style scoped>
/* Tokens oscuros locales: los componentes de siempre (inputs, botones) se adaptan solos */
.login {
  color-scheme: dark;
  --page: #08090b;
  --surface: rgba(255, 255, 255, 0.04);
  --surface-2: rgba(255, 255, 255, 0.06);
  --surface-hover: rgba(255, 255, 255, 0.08);
  --border: rgba(255, 255, 255, 0.08);
  --border-strong: rgba(255, 255, 255, 0.16);
  --text: #f4f3ef;
  --text-2: #b9b8b0;
  --muted: #7f7e78;
  --inverse: #08090b;
  --critical-text: #f08080;

  position: relative;
  display: grid;
  grid-template-columns: 7fr 5fr;
  min-height: 100dvh;
  overflow: hidden;
  background: var(--page);
  color: var(--text);
}

/* Escaparate */
.hero {
  position: relative;
  display: grid;
  grid-template-rows: auto 1fr;
  align-content: start;
  gap: 24px;
  padding: 28px 48px 48px;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  font-weight: 650;
  letter-spacing: -0.01em;
}

.brand {
  font-size: 16px;
}

.soft {
  color: var(--text-2);
  font-weight: 500;
}

.pitch {
  max-width: 720px;
  margin-top: 14vh;
}

h1 {
  font-size: clamp(36px, 4.4vw, 62px);
  line-height: 1.04;
  letter-spacing: -0.035em;
  font-weight: 700;
}

.accent {
  white-space: nowrap;
  background: linear-gradient(90deg, #86b6ef, #3987e5 45%, #eb6834 80%, #1baf7a);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.pitch p {
  margin-top: 14px;
  max-width: 480px;
  font-size: 15px;
  line-height: 1.55;
  color: var(--text-2);
}

.sources {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 20px;
  padding: 0;
  list-style: none;
}

.sources li {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--surface);
  font-size: 12px;
  color: var(--text-2);
}

.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
}

/* Formulario */
.panel {
  position: relative;
  display: grid;
  grid-template-rows: 1fr auto;
  place-items: center;
  padding: 32px;
}

.card {
  width: min(380px, 100%);
  padding: 32px;
  border: 1px solid var(--border);
  border-radius: 20px;
  background: rgba(20, 21, 24, 0.6);
  box-shadow:
    0 1px 0 rgba(255, 255, 255, 0.06) inset,
    0 30px 80px -30px rgba(0, 0, 0, 0.8);
  backdrop-filter: blur(18px);
}

h2 {
  font-size: 24px;
  letter-spacing: -0.03em;
}

.lead {
  margin: 6px 0 28px;
  font-size: 14px;
  color: var(--text-2);
}

.form {
  display: grid;
  gap: 16px;
}

.field span {
  color: var(--text-2);
}

.form :deep(.input) {
  width: 100%;
  height: 44px;
  font-size: 15px;
  background: rgba(255, 255, 255, 0.05);
  transition:
    border-color 0.15s,
    box-shadow 0.15s;
}

.form :deep(.input:focus) {
  border-color: #3987e5;
  box-shadow: 0 0 0 3px rgba(57, 135, 229, 0.25);
}

.remember {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--text-2);
  cursor: pointer;
  user-select: none;
}

.remember input {
  width: 16px;
  height: 16px;
  margin: 0;
  accent-color: #3987e5;
}

.error {
  display: flex;
  gap: 8px;
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  background: rgba(208, 59, 59, 0.14);
  color: var(--critical-text);
  font-size: 13px;
}

.error .icon {
  flex: none;
  margin-top: 2px;
}

.submit {
  justify-content: center;
  height: 46px;
  margin-top: 4px;
  border: 0;
  background: #f4f3ef;
  color: #08090b;
  font-size: 15px;
  font-weight: 600;
  transition:
    transform 0.15s,
    box-shadow 0.15s;
}

.submit:hover:not(:disabled) {
  background: #fff;
  box-shadow: 0 8px 30px -8px rgba(57, 135, 229, 0.6);
  transform: translateY(-1px);
}

.submit:hover .icon {
  transform: translateX(2px);
}

.submit .icon {
  transition: transform 0.15s;
}

.spin {
  animation: spin 0.9s linear infinite;
}

.or {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 18px 0;
  color: var(--muted);
  font-size: 12px;
}

.or::before,
.or::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--border);
}

.passkey-first {
  width: 100%;
  gap: 8px;
}

.submit.secondary {
  background: var(--surface-2);
  color: var(--text);
}

.submit.secondary:hover:not(:disabled) {
  background: var(--surface-hover);
  box-shadow: none;
}

.passkey {
  justify-content: center;
  gap: 8px;
  width: 100%;
  height: 46px;
  font-size: 15px;
  font-weight: 600;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.foot {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--muted);
}

@media (max-width: 960px) {
  .login {
    grid-template-columns: 1fr;
  }

  .hero {
    grid-template-rows: auto auto;
    padding: 20px 16px 8px;
    gap: 16px;
  }

  .pitch {
    margin-top: 6vh;
    text-align: center;
    justify-self: center;
  }

  .pitch p {
    margin-inline: auto;
  }

  .sources {
    justify-content: center;
  }

  .panel {
    padding: 8px 16px 24px;
    gap: 20px;
  }

  .card {
    padding: 24px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .spin {
    animation: none;
  }
}
</style>
