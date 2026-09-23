import { FleetSupplierPushTab } from './components/FleetSupplierPushTab'

export default function FleetSupplierPushPage() {
  return (
    <div className="admin-shell min-h-screen">
      <main className="admin-page space-y-5">
        <div className="admin-panel overflow-hidden">
          <div className="px-5 py-5">
            <FleetSupplierPushTab />
          </div>
        </div>
      </main>
    </div>
  )
}
