import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './styles.css';
import { AuthProvider, useAuth } from './lib/auth';
import { PeriodProvider } from './lib/period';
import Layout from './components/Layout';
import Login from './pages/Login';
import Painel from './pages/Painel';
import Manutencao from './pages/Manutencao';
import { Documentos, Motoristas, Veiculos } from './pages/Cadastros';
import { Abastecimentos, Velocidade, Viagens } from './pages/Registros';
import { Custos, Importacoes, Pendencias, Usuarios } from './pages/Gestao';
import { MinhaConta, Parametros } from './pages/Conta';

const qc = new QueryClient({ defaultOptions: { queries: { staleTime: 60_000, refetchOnWindowFocus: true, retry: 1 } } });

function Root() {
  const { me, loading, can } = useAuth();
  if (loading) return <div className="empty">Carregando…</div>;
  if (!me) return <Login />;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Painel />} />
        <Route path="manutencao" element={<Manutencao />} />
        <Route path="veiculos" element={<Veiculos />} />
        <Route path="motoristas" element={<Motoristas />} />
        <Route path="documentos" element={<Documentos />} />
        <Route path="viagens" element={<Viagens />} />
        <Route path="abastecimentos" element={<Abastecimentos />} />
        <Route path="velocidade" element={<Velocidade />} />
        <Route path="custos" element={<Custos />} />
        <Route path="pendencias" element={<Pendencias />} />
        <Route path="importacoes" element={<Importacoes />} />
        <Route path="conta" element={<MinhaConta />} />
        {!can('MOTORISTA') && <Route path="parametros" element={<Parametros />} />}
        {can('ADMIN') && <Route path="usuarios" element={<Usuarios />} />}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <AuthProvider><PeriodProvider><BrowserRouter><Root /></BrowserRouter></PeriodProvider></AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
