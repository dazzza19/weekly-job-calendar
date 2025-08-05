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
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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

    // ====== GET: Load all jobs ======
    if (method === 'GET') {
      const res = await client.query('SELECT id, date_key, job FROM job_bookings ORDER BY date_key');
      const results = res.rows.map(row => ({
        id: row.id,
        date_key: row.date_key,
        job: row.job
      }));
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(results),
      };
    }

    // ====== POST: Add new job ======
    if (method === 'POST' && body.type === 'add') {
      const { date_key, job } = body;
      await client.query(
        'INSERT INTO job_bookings (date_key, job) VALUES ($1, $2)',
        [date_key, job]
      );
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: true }),
      };
    }

    // ====== POST: Update job by date_key and index (used by frontend) ======
    if (method === 'POST' && body.type === 'update') {
      const { date_key, jobIndex, job } = body;
      const res = await client.query('SELECT id, job FROM job_bookings WHERE date_key = $1', [date_key]);
      const jobs = res.rows.map(r => r.job);
      if (jobIndex < 0 || jobIndex >= jobs.length) {
        return {
          statusCode: 400,
          body: JSON.stringify({ error: 'Invalid job index' })
        };
      }
      jobs[jobIndex] = job;

      // Delete all jobs for this date
      await client.query('DELETE FROM job_bookings WHERE date_key = $1', [date_key]);

      // Re-insert all jobs
      for (let j of jobs) {
        await client.query('INSERT INTO job_bookings (date_key, job) VALUES ($1, $2)', [date_key, j]);
      }

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: true }),
      };
    }

    // ====== POST: Delete job by ID (NEW - prevents duplication) ======
    if (method === 'POST' && body.type === 'deleteById') {
      const { id } = body;
      if (!id) {
        return {
          statusCode: 400,
          body: JSON.stringify({ error: 'Job ID is required' })
        };
      }

      const result = await client.query('DELETE FROM job_bookings WHERE id = $1', [id]);
      if (result.rowCount === 0) {
        return {
          statusCode: 404,
          body: JSON.stringify({ error: 'Job not found' })
        };
      }

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: true }),
      };
    }

    // ====== POST: Legacy delete by date_key + index (keep for compatibility) ======
    if (method === 'POST' && body.type === 'delete') {
      const { date_key, jobIndex } = body;
      const res = await client.query('SELECT job FROM job_bookings WHERE date_key = $1', [date_key]);
      const jobs = res.rows.map(r => r.job);

      if (jobIndex < 0 || jobIndex >= jobs.length) {
        return {
          statusCode: 400,
          body: JSON.stringify({ error: 'Invalid job index' })
        };
      }

      jobs.splice(jobIndex, 1);

      await client.query('DELETE FROM job_bookings WHERE date_key = $1', [date_key]);

      if (jobs.length > 0) {
        for (let job of jobs) {
          await client.query('INSERT INTO job_bookings (date_key, job) VALUES ($1, $2)', [date_key, job]);
        }
      }

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: true }),
      };
    }

    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  } catch (error) {
    console.error('Database error:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Internal server error', message: error.message }),
    };
  }
}
