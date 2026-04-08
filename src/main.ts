import './style.css'
import { query, subscribe } from './lib/mortise/db'

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <div>
    <h1>Mortise</h1>
    <p>Local-first sync engine</p>
    <div id="db-test">Initializing database...</div>
  </div>
`

async function testDatabase() {
  const output = document.getElementById('db-test')!;
  try {
    // 1. Create a table
    await query(`
      CREATE TABLE IF NOT EXISTS test_users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL
      );
    `);
    
    // Clear the table so testing is consistent
    await query(`DELETE FROM test_users`);

    // 2. Insert a record
    const idAlice = crypto.randomUUID();
    await query(`INSERT INTO test_users (id, name) VALUES ($1, $2)`, [idAlice, 'Alice']);

    let reactivityCount = 0;
    // 3. Setup Reactivity test
    subscribe(`SELECT * FROM test_users`, () => {
       reactivityCount++;
       query(`SELECT * FROM test_users`).then(r => {
           console.log("Reactivity triggered! Current Data:", r.rows);
           document.getElementById('reactivity-test')!.innerHTML = `
             <h3 style="color: green;">Reactivity Test: Fired ${reactivityCount} times! 🎉</h3>
             <pre>${JSON.stringify(r.rows, null, 2)}</pre>
           `;
       });
    });

    // 4. Query the records for initial render
    const result = await query(`SELECT * FROM test_users`);
    
    output.innerHTML = `
      <h3>Database Test Successful! 🎉</h3>
      <pre>${JSON.stringify(result.rows, null, 2)}</pre>
      <div id="reactivity-test">Waiting for reactivity...</div>
    `;

    // 5. Trigger Reactivity in background
    setTimeout(async () => {
      const idCharlie = crypto.randomUUID();
      await query(`INSERT INTO test_users (id, name) VALUES ($1, $2)`, [idCharlie, 'Charlie']);
      await query(`UPDATE test_users SET name = 'Alice (Updated)' WHERE id = $1`, [idAlice]);
    }, 1000);

  } catch (error: any) {
    output.innerHTML = `
      <h3 style="color: red;">Database Test Failed ❌</h3>
      <pre>${error.message || error.toString()}</pre>
    `;
    console.error('Database error:', error);
  }
}

testDatabase();
