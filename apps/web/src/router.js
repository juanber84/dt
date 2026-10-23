import { createRouter, createWebHistory } from 'vue-router';
import TodayView from './views/TodayView.vue';
import { isValidISODate, todayISO } from './lib/dates.js';
import { ensureSession, forgetSession } from './composables/useAuth.js';
import { onUnauthorized } from './api.js';
import { safeNext } from './lib/navigation.js';
import { startProgress } from './composables/useProgress.js';

export const router = createRouter({
  history: createWebHistory(),
  scrollBehavior: () => ({ top: 0 }),
  routes: [
    { path: '/', redirect: '/day' },
    {
      path: '/login',
      name: 'login',
      component: () => import('./views/LoginView.vue'),
      // Sin barra lateral ni tab bar, y lo único que se ve sin sesión
      meta: { bare: true, public: true },
    },
    {
      path: '/day/:date?',
      name: 'day',
      component: TodayView,
      beforeEnter: (to) => {
        const { date } = to.params;
        if (date && (!isValidISODate(date) || date > todayISO())) return { name: 'day' };
      },
    },
    { path: '/trends', name: 'trends', component: () => import('./views/TrendsView.vue') },
    { path: '/training', name: 'training', component: () => import('./views/TrainingView.vue') },
    { path: '/coach/:id?', name: 'coach', component: () => import('./views/CoachView.vue') },
    { path: '/clinical', name: 'clinical', component: () => import('./views/ClinicalView.vue') },
    // Los informes ya se revisan en el lateral de su día
    { path: '/clinical/:id', redirect: '/clinical' },
    { path: '/reports', name: 'reports', component: () => import('./views/ReportsView.vue') },
    { path: '/reports/:id', name: 'report', component: () => import('./views/ReportView.vue') },
    { path: '/admin', redirect: '/admin/connections' },
    {
      path: '/settings',
      name: 'settings',
      component: () => import('./views/admin/AccountView.vue'),
    },
    {
      path: '/admin/connections',
      name: 'connections',
      component: () => import('./views/admin/ConnectionsView.vue'),
    },
    {
      path: '/admin/sources',
      name: 'sources',
      component: () => import('./views/admin/SourcesView.vue'),
      meta: { role: 'admin' },
    },
    {
      path: '/admin/ai',
      name: 'ai',
      component: () => import('./views/admin/AiView.vue'),
      meta: { role: 'admin' },
    },
    {
      path: '/admin/system',
      name: 'system',
      component: () => import('./views/admin/SystemView.vue'),
      meta: { role: 'admin' },
    },
    { path: '/integrations', redirect: '/admin/connections' },
    { path: '/:pathMatch(.*)*', redirect: '/day' },
  ],
});

// Barra de carga mientras se baja el código de la pantalla nueva (las vistas van en trozos)
let navigationDone = () => {};
router.beforeEach(() => {
  navigationDone();
  navigationDone = startProgress();
});
router.afterEach(() => navigationDone());
router.onError(() => navigationDone());

// Sin sesión solo se ve /login; las rutas con `meta.role` exigen ese rol
router.beforeEach(async (to) => {
  const user = await ensureSession();
  if (to.meta.public) return user ? (safeNext(to.query.next) ?? { name: 'day' }) : true;
  if (!user) {
    return {
      name: 'login',
      query: to.name === 'day' && !to.params.date ? {} : { next: to.fullPath },
    };
  }
  if (to.meta.role && user.role !== to.meta.role) return { name: 'day' };
});

// Si la sesión caduca mientras usas la app, la siguiente llamada a la API te lleva al login
onUnauthorized(() => {
  forgetSession();
  const current = router.currentRoute.value;
  if (!current.meta.public) router.replace({ name: 'login', query: { next: current.fullPath } });
});
