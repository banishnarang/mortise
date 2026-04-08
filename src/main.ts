import './style.css'
import { query } from './lib/mortise/db'

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
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL
      );
    `);
    
    // 2. Insert a record
    await query(`INSERT INTO test_users (name) VALUES ($1)`, ['Alice']);
    await query(`INSERT INTO test_users (name) VALUES ($1)`, ['Bob']);

    // 3. Query the records
    const result = await query(`SELECT * FROM test_users`);
    
    output.innerHTML = `
      <h3>Database Test Successful! 🎉</h3>
      <pre>${JSON.stringify(result.rows, null, 2)}</pre>
    `;
  } catch (error: any) {
    output.innerHTML = `
      <h3 style="color: red;">Database Test Failed ❌</h3>
      <pre>${error.message || error.toString()}</pre>
    `;
    console.error('Database error:', error);
  }
}

testDatabase();
