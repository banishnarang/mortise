import assert from 'node:assert';
import { HLC } from './hlc.ts'; // Adding .ts extension for straightforward execution if needed

// Override Date.now for rigorous, deterministic testing
const originalNow = Date.now;
let mockTime = 1600000000000;
Date.now = () => mockTime;

// Test suite for the Mortise Hybrid Logical Clock (HLC)
const clock1 = new HLC('node-A');

try {
  console.log('Running test 1: Generating unique, sortable timestamps within the same physical ms');
  const t1 = clock1.now();
  const t2 = clock1.now();

  assert.notStrictEqual(t1, t2, 'Timestamps should be unique');
  assert.ok(t1 < t2, 't2 should be lexically greater than t1 within the same ms');
  
  const decoded1 = clock1.decode(t1);
  const decoded2 = clock1.decode(t2);

  assert.strictEqual(decoded1.logicalCounter, 1, 'First event in same ms gets counter 1');
  assert.strictEqual(decoded2.logicalCounter, 2, 'Second event increments counter to 2');


  console.log('Running test 2: Counter resets as physical time marches forward');
  mockTime += 1000;
  const t3 = clock1.now();
  
  assert.ok(t2 < t3, 't3 should be lexically greater after physical progression');
  const decoded3 = clock1.decode(t3);
  assert.strictEqual(decoded3.logicalCounter, 0, 'Counter should reset when physical clock ticks');


  console.log('Running test 3: `receive` boundary updates logic correctly to respect causality');
  const clock2 = new HLC('node-B');
  
  // Create a timestamp theoretically coming from an external node "in the future"
  const futurePhysical = mockTime + 5000;
  const futureTimestamp = clock2.encode(futurePhysical, 5, 'node-C');

  clock1.receive(futureTimestamp);
  
  const t4 = clock1.now();
  const decoded4 = clock1.decode(t4);
  
  assert.strictEqual(decoded4.physicalTime, futurePhysical, 'Clock should have fast-forwarded to highest known external time');
  assert.strictEqual(decoded4.logicalCounter, 7, 'Logical counter increments since physical times tied at maximum during `receive`');
  assert.ok(t4 > futureTimestamp, 'Local event generated post-receive must strictly sort AFTER the received event');


  console.log('✅ All HLC primitive tests passed successfully.');
} catch (error) {
  console.error('❌ Test failed:', error);
  process.exit(1);
} finally {
  Date.now = originalNow;
}
