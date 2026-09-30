import Spike from './spike/Spike';

/** Tiny path switch — no router dependency until the real app needs one. */
export default function App() {
  if (window.location.pathname === '/spike') return <Spike />;
  return (
    <main style={{ font: '16px system-ui', padding: 24 }}>
      <h1>Second Voice</h1>
      <p>
        Scaffold running. Phase 0 test page: <a href="/spike">/spike</a>
      </p>
    </main>
  );
}
