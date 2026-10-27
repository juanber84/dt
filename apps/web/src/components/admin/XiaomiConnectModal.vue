<script setup>
import { computed, ref, watch } from 'vue';
import { KeyRound, MailCheck, RefreshCw } from '@lucide/vue';
import Modal from '../ui/Modal.vue';
import PasswordInput from '../ui/PasswordInput.vue';
import { xiaomiLogin } from '../../services/twin.js';

const props = defineProps({ open: { type: Boolean, default: false } });
const emit = defineEmits(['close', 'connected']);

// La contraseña solo vive en este formulario mientras está abierto: hace falta si Xiaomi pide
// otro captcha y hay que empezar de nuevo. La API no la guarda.
const username = ref('');
const password = ref('');
const region = ref('de');

const step = ref('credentials'); // credentials | captcha | email
const loginId = ref(null);
const captcha = ref(null);
const code = ref('');
const error = ref(null);
const busy = ref(false);

const vFocus = { mounted: (el) => el.focus() };

watch(
  () => props.open,
  () => {
    password.value = '';
    step.value = 'credentials';
    error.value = null;
    busy.value = false;
  },
);

const titles = {
  credentials: 'Conectar Báscula (experimental)',
  captcha: 'Comprueba que no eres un robot',
  email: 'Código de verificación',
};
const submitLabel = computed(() => (step.value === 'credentials' ? 'Conectar' : 'Continuar'));

function apply(result) {
  if (result.status === 'CONNECTED') {
    password.value = '';
    emit('connected', result.connection);
    return;
  }
  loginId.value = result.loginId;
  code.value = '';
  if (result.status === 'CAPTCHA_REQUIRED') {
    step.value = 'captcha';
    captcha.value = result.captcha;
    if (result.captchaRetry) error.value = 'El texto no era correcto: prueba con esta otra imagen.';
  } else {
    step.value = 'email';
  }
}

const start = () =>
  xiaomiLogin.start({ username: username.value, password: password.value, region: region.value });

async function submit() {
  busy.value = true;
  error.value = null;
  try {
    if (step.value === 'credentials') apply(await start());
    else if (step.value === 'captcha') apply(await xiaomiLogin.captcha(loginId.value, code.value));
    else apply(await xiaomiLogin.emailCode(loginId.value, code.value));
  } catch (err) {
    await recover(err);
  } finally {
    busy.value = false;
  }
}

async function recover(err) {
  error.value = err.status === 401 ? 'Hace falta la clave de acceso de la API.' : err.message;
  if (err.code === 'INVALID_EMAIL_CODE') return (code.value = '');
  // Con el captcha mal hay que empezar de nuevo: se pide otra imagen sin volver a escribir nada
  if (err.code === 'INVALID_CAPTCHA') {
    try {
      apply(await start());
      error.value = 'El texto no era correcto: prueba con esta otra imagen.';
    } catch (again) {
      error.value = again.message;
      step.value = 'credentials';
    }
    return;
  }
  step.value = 'credentials';
}

async function newCaptcha() {
  busy.value = true;
  error.value = null;
  try {
    apply(await start());
  } catch (err) {
    await recover(err);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <Modal :open="open" :title="titles[step]" @close="emit('close')">
    <form id="xiaomi-form" class="form" @submit.prevent="submit">
      <template v-if="step === 'credentials'">
        <p class="secondary intro">
          No tiene OAuth: la API inicia sesión con la cuenta de la báscula y se queda solo con el
          usuario y el token. La contraseña no se guarda.
        </p>
        <label class="field">
          <span>Correo, teléfono o ID de la cuenta</span>
          <input
            v-model="username"
            v-focus
            class="input"
            type="text"
            autocomplete="username"
            required
          />
        </label>
        <label class="field">
          <span>Contraseña</span>
          <PasswordInput v-model="password" />
        </label>
        <label class="field">
          <span>Servidor</span>
          <select v-model="region" class="input">
            <option value="de">Europa (de)</option>
            <option value="cn">China (cn)</option>
            <option value="us">Estados Unidos (us)</option>
            <option value="sg">Singapur (sg)</option>
            <option value="ru">Rusia (ru)</option>
            <option value="i2">India (i2)</option>
          </select>
        </label>
      </template>

      <template v-else-if="step === 'captcha'">
        <p class="secondary intro">Escribe los caracteres que ves en la imagen.</p>
        <div class="captcha">
          <img :src="captcha" alt="Captcha" />
          <button class="btn btn-ghost btn-sm" type="button" :disabled="busy" @click="newCaptcha">
            <RefreshCw class="icon icon-sm" />
            Otra imagen
          </button>
        </div>
        <label class="field">
          <span>Texto de la imagen</span>
          <input
            :key="captcha"
            v-model="code"
            v-focus
            class="input code"
            type="text"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
            required
          />
        </label>
      </template>

      <template v-else>
        <p class="sent">
          <MailCheck class="icon" />
          <span
            >Te han enviado un código al correo de tu cuenta. Puede tardar un minuto; mira también
            en spam.</span
          >
        </p>
        <label class="field">
          <span>Código</span>
          <input
            v-model="code"
            v-focus
            class="input code"
            type="text"
            inputmode="numeric"
            autocomplete="one-time-code"
            required
          />
        </label>
      </template>

      <p v-if="error" class="error" role="alert">{{ error }}</p>
    </form>

    <p v-if="step === 'credentials'" class="note muted">
      <KeyRound class="icon icon-sm" />
      Suele pedir un captcha y un código por correo: los rellenas aquí mismo.
    </p>

    <template #footer>
      <button class="btn" type="button" @click="emit('close')">Cancelar</button>
      <button class="btn btn-primary" type="submit" form="xiaomi-form" :disabled="busy">
        {{ busy ? 'Un momento…' : submitLabel }}
      </button>
    </template>
  </Modal>
</template>

<style scoped>
.intro {
  font-size: 13px;
}

.form {
  display: grid;
  gap: 12px;
}

.captcha {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: #fff;
}

.captcha img {
  display: block;
  height: 56px;
  max-width: 100%;
}

.captcha .btn {
  color: #4a4642;
}

.code {
  font-size: 16px;
  letter-spacing: 0.08em;
}

.sent {
  display: flex;
  gap: 10px;
  font-size: 13px;
  color: var(--text-2);
}

.sent .icon {
  flex: none;
  margin-top: 1px;
}

.error {
  font-size: 13px;
  color: var(--critical-text);
}

.note {
  display: flex;
  gap: 6px;
  font-size: 12px;
}

.note .icon {
  margin-top: 2px;
}
</style>
