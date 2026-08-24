import { NextResponse } from "next/server";

import { neon } from "@neondatabase/serverless";

function getSql() {

  const connectionString =

    process.env.STORAGE_DATABASE_URL || process.env.DATABASE_URL;

  if (!connectionString) {

    throw new Error("Database connection is not configured");

  }

  return neon(connectionString);

}

async function ensureJobsTable() {

  const sql = getSql();

  await sql`

    CREATE TABLE IF NOT EXISTS jobs (

      id TEXT PRIMARY KEY,

      work_mode TEXT NOT NULL,

      client_id TEXT,

      data JSONB NOT NULL,

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()

    )

  `;

  return sql;

}

export async function GET(request: Request) {

  try {

    const sql = await ensureJobsTable();

    const { searchParams } = new URL(request.url);

    const workMode = searchParams.get("workMode");

    const clientId = searchParams.get("clientId");

    let jobs;

    if (workMode === "client" && clientId) {

      jobs = await sql`

        SELECT id, work_mode, client_id, data, created_at, updated_at

        FROM jobs

        WHERE work_mode = 'client' AND client_id = ${clientId}

        ORDER BY updated_at DESC

      `;

    } else {

      jobs = await sql`

        SELECT id, work_mode, client_id, data, created_at, updated_at

        FROM jobs

        WHERE work_mode = 'store'

        ORDER BY updated_at DESC

      `;

    }

    return NextResponse.json({

      success: true,

      jobs,

    });

  } catch (error) {

    console.error("GET /api/jobs failed:", error);

    return NextResponse.json(

      { success: false, error: "Failed to load jobs" },

      { status: 500 }

    );

  }

}

export async function POST(request: Request) {

  try {

    const body = await request.json();

    const id = body?.id;

    const workMode = body?.workMode;

    const clientId = body?.clientId ?? null;

    const data = body?.data;

    if (typeof id !== "string" || !id) {

      return NextResponse.json(

        { success: false, error: "Job id is required" },

        { status: 400 }

      );

    }

    if (workMode !== "store" && workMode !== "client") {

      return NextResponse.json(

        { success: false, error: "Invalid work mode" },

        { status: 400 }

      );

    }

    if (workMode === "client" && !clientId) {

      return NextResponse.json(

        { success: false, error: "Client id is required" },

        { status: 400 }

      );

    }

    if (!data || typeof data !== "object") {

      return NextResponse.json(

        { success: false, error: "Job data is required" },

        { status: 400 }

      );

    }

    const sql = await ensureJobsTable();

    await sql`

      INSERT INTO jobs (id, work_mode, client_id, data, updated_at)

      VALUES (${id}, ${workMode}, ${clientId}, ${JSON.stringify(data)}::jsonb, NOW())

      ON CONFLICT (id)

      DO UPDATE SET

        work_mode = EXCLUDED.work_mode,

        client_id = EXCLUDED.client_id,

        data = EXCLUDED.data,

        updated_at = NOW()

    `;

    return NextResponse.json({ success: true });

  } catch (error) {

    console.error("POST /api/jobs failed:", error);

    return NextResponse.json(

      { success: false, error: "Failed to save job" },

      { status: 500 }

    );

  }

}
