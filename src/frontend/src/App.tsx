import { Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/layout/Layout';
import { OnboardingWizard } from './pages/onboarding';
import { SKUMappingPage } from './pages/sku-mapping';
import { DashboardPage } from './pages/dashboard';

function DataSyncPage() {
  return (
    <div>
      <h1>数据同步</h1>
      <p>多渠道数据同步管理</p>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/onboarding" element={<OnboardingWizard />} />
        <Route path="/sku-mapping" element={<SKUMappingPage />} />
        <Route path="/data-sync" element={<DataSyncPage />} />
      </Route>
    </Routes>
  );
}
