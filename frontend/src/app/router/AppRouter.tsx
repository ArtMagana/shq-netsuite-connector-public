import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from '../AppShell'
import { BancosPage } from '../../features/bancos/BancosPage'
import {
  EgresosDetalleConciliacionPage,
  EgresosPage,
} from '../../features/egresos/EgresosPage'
import { EntitiesPage } from '../../features/entities/EntitiesPage'
import { FacturasSatPage } from '../../features/facturasSat/FacturasSatPage'
import { HomePage } from '../../features/home/HomePage'
import { IngresosPage } from '../../features/ingresos/IngresosPage'
import { InventoryPage } from '../../features/inventory/InventoryPage'
import { InventoryAdjustmentsPage } from '../../features/inventory/InventorySettingsPage'
import { PublicTestDiagnosticsPage } from '../../features/lab/PublicTestDiagnosticsPage'
import { SearchFindPage } from '../../features/searchFind/SearchFindPage'

export function AppRouter() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<AppShell />}>
          <Route index element={<Navigate to="/home" replace />} />
          <Route path="home" element={<HomePage />} />
          <Route path="dashboard" element={<Navigate to="/home" replace />} />
          <Route path="inventario" element={<InventoryPage />} />
          <Route path="inventario/ajustes" element={<InventoryAdjustmentsPage />} />
          <Route path="inventario/*" element={<Navigate to="/inventario/" replace />} />
          <Route path="ingresos" element={<IngresosPage />} />
          <Route path="egresos" element={<EgresosPage />} />
          <Route
            path="egresos/detalleconciliacion"
            element={<EgresosDetalleConciliacionPage />}
          />
          <Route path="analysis" element={<Navigate to="/ingresos" replace />} />
          <Route path="bancos" element={<Navigate to="/bancos/payana-higo" replace />} />
          <Route path="bancos/:bankSlug" element={<BancosPage />} />
          <Route path="lab" element={<PublicTestDiagnosticsPage />} />
          <Route path="facturas-sat/*" element={<FacturasSatPage />} />
          <Route path="queue" element={<Navigate to="/facturas-sat" replace />} />
          <Route path="entidades" element={<EntitiesPage />} />
          <Route path="entidades/:entityKind" element={<EntitiesPage />} />
          <Route path="rules" element={<Navigate to="/entidades" replace />} />
          <Route path="search-find" element={<SearchFindPage />} />
          <Route path="audit" element={<Navigate to="/search-find" replace />} />
          <Route path="*" element={<Navigate to="/home" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  )
}
