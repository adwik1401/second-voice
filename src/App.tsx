import BankApp from './app/BankApp';
import Spike from './spike/Spike';

/** Tiny path switch — no router dependency. `/` is the Larkmoor bank app; `/spike` is the Phase 0 test page. */
export default function App() {
  if (window.location.pathname === '/spike') return <Spike />;
  return <BankApp />;
}
