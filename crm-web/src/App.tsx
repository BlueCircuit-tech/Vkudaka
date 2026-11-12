import React from 'react';
import { BrowserRouter, NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { session } from './api/client';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { UsersPage } from './pages/UsersPage';
import { CategoryPickerPage } from './pages/CategoryPickerPage';
import { ModerationPage } from './pages/ModerationPage';
import { PlansPage } from './pages/PlansPage';
import { ProductsPage } from './pages/ProductsPage';
import { EventsPage } from './pages/EventsPage';
import { ModelsPage } from './pages/ModelsPage';
import { ShippingPage } from './pages/ShippingPage';
import { NotificationsPage } from './pages/NotificationsPage';
import { ContentPage } from './pages/ContentPage';
import { OrdersPage } from './pages/OrdersPage';
import { PaymentsPage } from './pages/PaymentsPage';
import { ModelApplyPage } from './pages/ModelApplyPage';

/** Estrutura do painel CRM (3.1 a 3.7). */

const ROLE_LABEL: Record<string, string> = {
  ADMIN: 'Administração',
  STAFF: 'Operação',
  GATE: 'Portaria',
};

/**
 * Navegação declarada em um lugar só: a ordem das seções é a ordem em que a
 * casa pensa — primeiro o que aconteceu, depois o clube, a operação e a voz.
 */
const NAV: Array<{ group: string; items: Array<{ to: string; label: string; end?: boolean }> }> = [
  {
    group: 'Visão geral',
    items: [
      { to: '/', label: 'Dashboard', end: true },
      { to: '/pedidos', label: 'Pedidos' },
    ],
  },
  {
    group: 'Clube',
    items: [
      { to: '/planos', label: 'Planos e descontos' },
      { to: '/usuarios', label: 'Assinantes' },
      { to: '/moderacao', label: 'Denúncias' },
    ],
  },
  {
    group: 'Operação',
    items: [
      { to: '/produtos', label: 'Coleção' },
      { to: '/categoria-app', label: 'Mudar Categoria APP' },
      { to: '/eventos', label: 'Eventos e portaria' },
      { to: '/modelos', label: 'Modelos' },
      { to: '/logistica', label: 'Logística e fretes' },
    ],
  },
  {
    group: 'Financeiro',
    items: [{ to: '/pagamentos', label: 'Pagamentos (Mercado Pago)' }],
  },
  {
    group: 'Comunicação',
    items: [
      { to: '/push', label: 'Push notifications' },
      { to: '/conteudo', label: 'Textos do app' },
    ],
  },
];

function Shell({ children }: { children: React.ReactNode }) {
  const user = session.user();

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">
          <img src="/logo-preto.png" alt="VKUDAKA — moda com essência" />
        </div>
        <div className="sidebar-rule" />

        {NAV.map((section) => (
          <nav key={section.group} className="nav-group" aria-label={section.group}>
            <span className="group">{section.group}</span>
            {section.items.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end}>
                {item.label}
              </NavLink>
            ))}
          </nav>
        ))}

        <div className="sidebar-foot">
          {user ? (
            <div className="who">
              <strong>{user.fullName}</strong>
              <span>{ROLE_LABEL[user.role] ?? user.role}</span>
            </div>
          ) : null}
          <button
            className="ghost tiny"
            style={{ width: '100%' }}
            onClick={() => {
              session.clear();
              window.location.href = '/login';
            }}
          >
            Sair
          </button>
        </div>
      </aside>

      <main className="main">{children}</main>
    </div>
  );
}

function Protected({ children }: { children: React.ReactNode }) {
  if (!session.get()) return <Navigate to="/login" replace />;
  return <Shell>{children}</Shell>;
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        {/* Formulário público de modelos (3.5) — sem autenticação. */}
        <Route path="/cadastro-modelo" element={<ModelApplyPage />} />
        <Route path="/" element={<Protected><DashboardPage /></Protected>} />
        <Route path="/pedidos" element={<Protected><OrdersPage /></Protected>} />
        <Route path="/planos" element={<Protected><PlansPage /></Protected>} />
        <Route path="/usuarios" element={<Protected><UsersPage /></Protected>} />
        <Route path="/categoria-app" element={<Protected><CategoryPickerPage /></Protected>} />
        <Route path="/moderacao" element={<Protected><ModerationPage /></Protected>} />
        <Route path="/produtos" element={<Protected><ProductsPage /></Protected>} />
        <Route path="/eventos" element={<Protected><EventsPage /></Protected>} />
        <Route path="/modelos" element={<Protected><ModelsPage /></Protected>} />
        <Route path="/logistica" element={<Protected><ShippingPage /></Protected>} />
        <Route path="/pagamentos" element={<Protected><PaymentsPage /></Protected>} />
        <Route path="/push" element={<Protected><NotificationsPage /></Protected>} />
        <Route path="/conteudo" element={<Protected><ContentPage /></Protected>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
