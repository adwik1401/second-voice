import BankApp from './app/BankApp';
import Simulator from './simulator/Simulator';

/**
 * Two pages, no router dependency:
 *  `/`           the Larkmoor bank app with the Voice Check and the Fraud Officer Panel
 *  `/simulator`  the phone-side "scammer" for demos (see src/simulator)
 */
export default function App() {
  return window.location.pathname === '/simulator' ? <Simulator /> : <BankApp />;
}
