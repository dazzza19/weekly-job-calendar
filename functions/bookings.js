// functions/bookings.js
import { Client } from 'pg';

const client = new Client({
  connectionString: process.env.DATABASE_URL,
});

let clientPromise;

async function getClient() {
  if (!clientPromise) {
    await client.connect();
    clientPromise = Promise.resolve(client);
  }
  return client;
}

async function initDB() {
  const client = await getClient();
  await client.query(`
    CREATE TABLE IF NOT EXISTS job_bookings (
      id TEXT PRIMARY KEY,
      date_key TEXT NOT NULL,
      job JSONB NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);
}

export async function handler(event, context) {
  try {
    await initDB();
    const client = await getClient();
    const method = event.httpMethod;
    const body = event.body ? JSON.parse(event.body) : {};

    if (method === 'GET') {
      const res = await client.query('SELECT id, date_key, job FROM job_bookings ORDER BY date_key');
      const bookings = {};
      for (let row of res.rows) {
        if (!bookings[row.date_key]) bookings[row.date_key] = [];
        bookings[row.date_key].push({ id: row.id, ...row.job });
      }
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bookings),
      };
    }

    if (method === 'POST' && body.type === 'add') {
      const { date_key, job } = body;
      const id = job.id || `${date_key}-${Date.now()}`;
      await client.query(
        'INSERT INTO job_bookings (id, date_key, job) VALUES ($1, $2, $3)',
        [id, date_key, job]
      );
      return {
        statusCode: 200,
        body: JSON.stringify({ success: true, id }),
      };
    }

    if (method === 'POST' && body.type === 'update') {
      const { date_key, id, job } = body;
      await client.query(
        'UPDATE job_bookings SET job = $1 WHERE id = $2 AND date_key = $3',
        [job, id, date_key]
      );
      return {
        statusCode: 200,
        body: JSON.stringify({ success: true }),
      };
    }

    if (method === 'POST' && body.type === 'delete') {
      const { id } = body;
      await client.query('DELETE FROM job_bookings WHERE id = $1', [id]);
      return {
        statusCode: 200,
        body: JSON.stringify({ success: true }),
      };
    }

    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  } catch (error) {
    console.error('Database error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error', message: error.message }),
    };
  }
}
