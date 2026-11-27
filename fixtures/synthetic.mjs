// Artificial changing alpha values; no recorded measurements or participant identities.
export const scenarios = Object.freeze(['clean', 'held-ear', 'bad-contact', 'headband-off', 'silent']);

export function* syntheticFrames({ scenario = 'clean', seconds = 30 } = {}) {
  if (!scenarios.includes(scenario)) throw new Error(`Unknown scenario: ${scenario}`);
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > 3600) throw new RangeError('seconds must be in 0..3600');
  for (let seq = 0; seq <= Math.floor(seconds * 10); seq++) {
    const atMs = seq * 100;
    const fault = atMs >= 15000 && atMs < 20000;
    const stamp = atMs + 1250; // Sender clock deliberately differs from local time.
    const tsSec = Math.floor(stamp / 1000), tsMicros = (stamp % 1000) * 1000;
    const alpha = [-1, -1.2, -1.1, -0.9].map((base, channel) =>
      Math.fround(base + 0.08 * Math.sin(seq * 0.31 + channel)));
    if (scenario === 'held-ear' && fault) alpha[0] = -1;
    const good = scenario === 'bad-contact' && fault ? [0, 1, 1, 0] : [1, 1, 1, 1];
    const on = scenario === 'headband-off' && fault ? 0 : 1;
    const messages = scenario === 'silent' && fault ? [] : [
      { address: '/mindfield/v2/is_good', values: [seq, tsSec, tsMicros, ...good] },
      { address: '/mindfield/v2/artifact', values: [tsSec, tsMicros, on, 0, 0] },
      { address: '/mindfield/v2/band/alpha', values: [seq, tsSec, tsMicros, ...alpha] },
    ];
    yield { atMs, messages };
  }
}
