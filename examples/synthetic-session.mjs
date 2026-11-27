import { createSensorValidity, createFitWindow, createGameSignal, stepGameSignal } from '../src/index.mjs';
import { syntheticFrames } from '../fixtures/synthetic.mjs';

const validity = createSensorValidity();
const fit = createFitWindow();
const game = createGameSignal();
console.log('Artificial stream: TP9 held from 15–20 s. No hardware or recording.');
for (const { atMs, messages } of syntheticFrames({ scenario: 'held-ear' })) {
  for (const { address, values } of messages) validity.ingest(address, values, atMs);
  if (atMs % 500 !== 0) continue;
  const sensors = validity.snapshot(atMs + 50);
  const view = fit.observe(sensors, (atMs + 50) / 1000);
  const ears = ['tp9', 'tp10'].filter(name => sensors[name].valid);
  const value = ears.length ? ears.reduce((sum, name) => sum + sensors[name].bands.alpha, 0) / ears.length : null;
  const walking = stepGameSignal(game, value, 0.5);
  if (atMs % 5000 === 0 || atMs === 17000) console.log(JSON.stringify({ seconds: atMs / 1000,
    fit: view.state, bestEarShare: view.bestEarShare, usableEars: ears.length,
    tp9Reasons: sensors.tp9.reasons, walking }));
}
