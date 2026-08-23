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

async function ensureClientsTable() {

  const sql = getSql();

  await sql`

    CREATE TABLE IF NOT EXISTS clients (

      id TEXT PRIMARY KEY,

      name TEXT NOT NULL,

      active BOOLEAN NOT NULL DEFAULT TRUE,

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()

    )

  `;

  return sql;

}

export async function GET() {

  try {

    const sql = await ensureClientsTable();

    const clients = await sql`

      SELECT id, name, active

      FROM clients

      ORDER BY created_at ASC

    `;

    return NextResponse.json({

      success: true,

      clients,

    });

  } catch (error) {

    console.error("GET /api/clients failed:", error);

    return NextResponse.json(

      { success: false, error: "Failed to load clients" },

      { status: 500 }

    );

  }

}

export async function POST(request: Request) {

  try {

    const body = await request.json();

    const clients = body?.clients;

    if (!Array.isArray(clients)) {

      return NextResponse.json(

        { success: false, error: "clients must be an array" },

        { status: 400 }

      );

    }

    const sql = await ensureClientsTable();

    await sql`DELETE FROM clients`;

    for (const client of clients) {

      if (

        typeof client?.id !== "string" ||

        typeof client?.name !== "string" ||

        typeof client?.active !== "boolean"

      ) {

        continue;

      }

      await sql`

        INSERT INTO clients (id, name, active)

        VALUES (${client.id}, ${client.name}, ${client.active})

      `;

    }

    return NextResponse.json({

      success: true,

      clients,

    });

  } catch (error) {

    console.error("POST /api/clients failed:", error);

    return NextResponse.json(

      { success: false, error: "Failed to save clients" },

      { status: 500 }

    );

  }

}
export async function PATCH(request: Request) {

  try {

    const sql = await ensureClientsTable();

    const body = await request.json();

    const id = String(body?.id || "").trim();

    const name = String(body?.name || "").trim();

    if (!id || !name) {

      return NextResponse.json(

        { success: false, error: "Client id and name are required" },

        { status: 400 }

      );

    }

    const updated = await sql`

      UPDATE clients

      SET name = ${name}

      WHERE id = ${id}

      RETURNING id, name, active

    `;

    if (updated.length === 0) {

      return NextResponse.json(

        { success: false, error: "Client not found" },

        { status: 404 }

      );

    }

    return NextResponse.json({

      success: true,

      client: updated[0],

    });

  } catch (error) {

    console.error("PATCH /api/clients failed:", error);

    return NextResponse.json(

      { success: false, error: "Failed to update client" },

      { status: 500 }

    );

  }

}
