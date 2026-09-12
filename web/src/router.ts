import { createRouter, createWebHashHistory } from 'vue-router';
import { useAuth } from './store';

const routes = [
  { path: '/login', component: () => import('./views/Login.vue'), meta: { public: true } },
  { path: '/', redirect: '/desk' },
  { path: '/parent', component: () => import('./views/ParentView.vue'), meta: { roles: ['parent'] } },
  { path: '/desk', component: () => import('./views/DeskView.vue'), meta: { roles: ['staff', 'volunteer', 'admin', 'security'] } },
  { path: '/seats', component: () => import('./views/SeatsView.vue'), meta: { roles: ['staff', 'volunteer', 'admin'] } },
  { path: '/incidents', component: () => import('./views/IncidentsView.vue') },
  { path: '/pickup', component: () => import('./views/PickupView.vue') },
  { path: '/patrols', component: () => import('./views/PatrolView.vue'), meta: { roles: ['security', 'staff', 'admin'] } },
  { path: '/timeline', component: () => import('./views/TimelineView.vue') },
  { path: '/archive', component: () => import('./views/ArchiveView.vue'), meta: { roles: ['staff', 'admin', 'volunteer', 'security'] } },
  { path: '/weekly', component: () => import('./views/WeeklyView.vue'), meta: { roles: ['staff', 'admin'] } },
  { path: '/watchlist', component: () => import('./views/WatchlistView.vue'), meta: { roles: ['staff', 'admin', 'volunteer', 'security'] } },
  { path: '/settings', component: () => import('./views/SettingsView.vue'), meta: { roles: ['staff', 'admin'] } },
];

export const router = createRouter({ history: createWebHashHistory(), routes });

router.beforeEach((to) => {
  const auth = useAuth();
  if (to.meta.public) return true;
  if (!auth.isLogin) return '/login';
  if (to.meta.roles && !(to.meta.roles as string[]).includes(auth.role)) return '/login';
  return true;
});
