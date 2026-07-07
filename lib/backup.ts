import * as zlib from "node:zlib";
import { del, list, put } from "@vercel/blob";
import { eq } from "drizzle-orm";
import { db, getClientForUrl } from "../db/index";
import * as schema from "../db/schema";
import { decrypt } from "./crypto";

const INTERVAL_MS = {
  "3_DAYS": 3 * 24 * 60 * 60 * 1000,
  "1_WEEK": 7 * 24 * 60 * 60 * 1000,
  "1_MONTH": 30 * 24 * 60 * 60 * 1000,
  "1_YEAR": 365 * 24 * 60 * 60 * 1000,
};

interface ColumnInfo {
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
  character_maximum_length: number | null;
  is_primary_key: boolean;
}

interface ForeignKeyInfo {
  local_column: string;
  foreign_table: string;
  foreign_column: string;
  on_delete: string;
}

/**
 * Normalizes table names by removing schemas/quotes (e.g. 'public.users' or '"users"' -> 'users').
 */
function cleanTableName(name: string): string {
  return name
    .replace(/^public\./, "")
    .replace(/"/g, "")
    .trim();
}

/**
 * Performs DFS-based topological sorting of tables.
 */
function getTopologicalSortedTables(
  tableNames: string[],
  dependencies: { table: string; refTable: string }[],
): string[] {
  const adj = new Map<string, string[]>();
  for (const name of tableNames) {
    adj.set(name, []);
  }

  for (const dep of dependencies) {
    const table = cleanTableName(dep.table);
    const refTable = cleanTableName(dep.refTable);
    if (adj.has(table) && adj.has(refTable)) {
      adj.get(table)?.push(refTable);
    }
  }

  const visited = new Set<string>();
  const temp = new Set<string>();
  const order: string[] = [];

  function visit(node: string) {
    if (temp.has(node)) return; // Cycle detected, break to avoid infinite loop
    if (!visited.has(node)) {
      temp.add(node);
      const deps = adj.get(node) || [];
      for (const dep of deps) {
        visit(dep);
      }
      temp.delete(node);
      visited.add(node);
      order.push(node);
    }
  }

  for (const name of tableNames) {
    if (!visited.has(name)) {
      visit(name);
    }
  }

  return order;
}

/**
 * Formats Javascript data types into SQL strings.
 */
function formatValue(value: any): string {
  if (value === null || value === undefined) {
    return "NULL";
  }
  if (value instanceof Date) {
    return `'${value.toISOString()}'`;
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "number") {
    return String(value);
  }
  if (typeof value === "object") {
    if (Buffer.isBuffer(value)) {
      return `E'\\\\x${value.toString("hex")}'`;
    }
    return `'${JSON.stringify(value).replace(/'/g, "''")}'`;
  }
  return `'${String(value).replace(/'/g, "''")}'`;
}

/**
 * Core function to backup a single database target.
 */
export async function runBackupJob(
  databaseId: number,
  isManualOverride: boolean,
) {
  // 1. Fetch database configuration from central DB
  const records = await db
    .select()
    .from(schema.databases)
    .where(eq(schema.databases.id, databaseId))
    .limit(1);
  if (records.length === 0) {
    throw new Error(`Database target config with ID ${databaseId} not found`);
  }
  const dbRecord = records[0];

  console.log(
    `Starting backup for database "${dbRecord.name}" (ID: ${dbRecord.id}). Manual Override: ${isManualOverride}`,
  );

  // 2. Check if backup is due
  if (!isManualOverride && dbRecord.lastSuccessAt) {
    const lastRun = new Date(dbRecord.lastSuccessAt).getTime();
    let intervalMs = 0;

    if (dbRecord.interval === "CUSTOM") {
      const days = dbRecord.customDays || 1;
      intervalMs = days * 24 * 60 * 60 * 1000;
    } else {
      intervalMs = INTERVAL_MS[dbRecord.interval] || INTERVAL_MS["1_WEEK"];
    }

    const timeElapsed = Date.now() - lastRun;
    if (timeElapsed < intervalMs) {
      const nextRunTime = new Date(lastRun + intervalMs);
      console.log(
        `Backup for "${dbRecord.name}" skipped. Next scheduled backup at: ${nextRunTime.toISOString()}`,
      );
      return {
        success: true,
        skipped: true,
        message: `Interval not reached. Next backup due at: ${nextRunTime.toLocaleDateString()}`,
        dbRecord,
      };
    }
  }

  // 3. Decrypt connection URL and connect directly to target DB
  const targetUrl = decrypt(dbRecord.encryptedUrl);
  const client = getClientForUrl(targetUrl);
  await client.connect();

  try {
    // A. Introspect User Tables in public schema (excluding drizzle / databases metadata)
    const tablesQuery = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND table_type = 'BASE TABLE'
        AND table_name != 'databases'
        AND table_name != 'backup_settings'
        AND table_name != '_drizzle_migrations';
    `);
    const tableNames = tablesQuery.rows.map((r) => r.table_name);

    if (tableNames.length === 0) {
      console.warn(`No tables found to back up in database "${dbRecord.name}"`);
      // Update success with message
      await db
        .update(schema.databases)
        .set({
          lastSuccessAt: new Date(),
          lastStatus: "SUCCESS",
          lastError: "Warning: No user tables found in database",
          updatedAt: new Date(),
        })
        .where(eq(schema.databases.id, dbRecord.id));

      return {
        success: true,
        skipped: false,
        message: "No tables found to backup",
        url: null,
      };
    }

    // B. Introspect Foreign Key Dependencies for Topological Sorting
    const depsQuery = await client.query(`
      SELECT 
          conrelid::regclass::text AS table_name, 
          confrelid::regclass::text AS referenced_table_name
      FROM pg_constraint
      WHERE contype = 'f' 
        AND connamespace = 'public'::regnamespace;
    `);

    const dependencies = depsQuery.rows.map((r) => ({
      table: r.table_name,
      refTable: r.referenced_table_name,
    }));

    // Perform topological sorting (parents first, children last)
    const sortedTableNames = getTopologicalSortedTables(
      tableNames,
      dependencies,
    );

    console.log(
      `Topological table order for "${dbRecord.name}":`,
      sortedTableNames,
    );

    let sqlDump = `-- Neon Backup SQL Dump for: ${dbRecord.name}\n`;
    sqlDump += `-- Generated: ${new Date().toISOString()}\n\n`;

    // Disable triggers and foreign keys during restore
    sqlDump += `SET session_replication_role = 'replica';\n\n`;

    // C. Generate DROPs in reverse order
    sqlDump += `-- 1. Drop existing tables\n`;
    for (let i = sortedTableNames.length - 1; i >= 0; i--) {
      sqlDump += `DROP TABLE IF EXISTS ${sortedTableNames[i]} CASCADE;\n`;
    }
    sqlDump += `\n`;

    // D. Generate CREATEs in topological order
    sqlDump += `-- 2. Create tables structure\n`;
    for (const tableName of sortedTableNames) {
      // 1. Get Columns info
      const colQuery = await client.query(
        `
        SELECT 
            c.column_name, 
            c.data_type, 
            c.is_nullable, 
            c.column_default, 
            c.character_maximum_length,
            (SELECT COUNT(*) 
             FROM information_schema.table_constraints tc 
             JOIN information_schema.key_column_usage kcu 
               ON tc.constraint_name = kcu.constraint_name 
               AND tc.table_schema = kcu.table_schema 
             WHERE tc.constraint_type = 'PRIMARY KEY' 
               AND tc.table_name = c.table_name 
               AND kcu.column_name = c.column_name) > 0 AS is_primary_key
        FROM information_schema.columns c
        WHERE c.table_schema = 'public' 
          AND c.table_name = $1
        ORDER BY c.ordinal_position;
      `,
        [tableName],
      );
      const columns: ColumnInfo[] = colQuery.rows;

      // 2. Get Foreign Keys info
      const fkQuery = await client.query(
        `
        SELECT 
            kcu.column_name AS local_column,
            ccu.table_name AS foreign_table,
            ccu.column_name AS foreign_column,
            rc.delete_rule AS on_delete
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu 
          ON tc.constraint_name = kcu.constraint_name 
          AND tc.table_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage ccu 
          ON ccu.constraint_name = tc.constraint_name 
          AND ccu.table_schema = tc.table_schema
        JOIN information_schema.referential_constraints rc
          ON rc.constraint_name = tc.constraint_name
        WHERE tc.constraint_type = 'FOREIGN KEY' 
          AND tc.table_name = $1;
      `,
        [tableName],
      );
      const foreignKeys: ForeignKeyInfo[] = fkQuery.rows;

      const colDefs = columns.map((col) => {
        let typeStr = col.data_type;
        let isSerial = false;

        // Detect serial/bigserial columns
        if (col.column_default?.startsWith("nextval('")) {
          isSerial = true;
          typeStr = col.data_type === "bigint" ? "bigserial" : "serial";
        }

        let def = `${col.column_name} `;
        if (isSerial) {
          def += typeStr;
        } else {
          if (col.data_type === "character varying") {
            def += col.character_maximum_length
              ? `varchar(${col.character_maximum_length})`
              : "varchar";
          } else {
            def += col.data_type;
          }
        }

        if (col.is_primary_key) {
          def += " PRIMARY KEY";
        } else {
          if (col.is_nullable === "NO") {
            def += " NOT NULL";
          }
          if (col.column_default && !isSerial) {
            def += ` DEFAULT ${col.column_default}`;
          }
        }

        return def;
      });

      const fkDefs = foreignKeys.map((fk) => {
        const onDelete =
          fk.on_delete && fk.on_delete !== "NO ACTION"
            ? ` ON DELETE ${fk.on_delete}`
            : "";
        return `FOREIGN KEY (${fk.local_column}) REFERENCES ${fk.foreign_table}(${fk.foreign_column})${onDelete}`;
      });

      const allDefs = [...colDefs, ...fkDefs];
      sqlDump += `CREATE TABLE ${tableName} (\n  ${allDefs.join(",\n  ")}\n);\n\n`;
    }

    // E. Generate INSERTs in topological order
    sqlDump += `-- 3. Insert table data\n`;
    for (const tableName of sortedTableNames) {
      // Get column names to structure insert queries
      const colNamesQuery = await client.query(
        `
        SELECT column_name, data_type, column_default
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
        ORDER BY ordinal_position;
      `,
        [tableName],
      );

      const cols = colNamesQuery.rows;
      const columnNames = cols.map((c) => c.column_name);

      const res = await client.query(`SELECT * FROM ${tableName};`);

      if (res.rows.length > 0) {
        sqlDump += `-- Data for table: ${tableName}\n`;

        for (const row of res.rows) {
          const values = columnNames.map((col) => formatValue(row[col]));
          sqlDump += `INSERT INTO ${tableName} (${columnNames.join(", ")}) VALUES (${values.join(", ")});\n`;
        }

        // Reset sequence index for serial/bigserial columns
        const serialCol = cols.find((c) =>
          c.column_default?.startsWith("nextval('"),
        );
        if (serialCol) {
          sqlDump += `SELECT setval(pg_get_serial_sequence('${tableName}', '${serialCol.column_name}'), coalesce(max(${serialCol.column_name}), 1), max(${serialCol.column_name}) IS NOT NULL) FROM ${tableName};\n`;
        }
        sqlDump += `\n`;
      }
    }

    // Restore replication role configuration
    sqlDump += `SET session_replication_role = 'origin';\n`;

    // 4. Compress to Gzip in memory
    const sqlBuffer = Buffer.from(sqlDump, "utf8");
    const gzipBuffer = zlib.gzipSync(sqlBuffer);

    // 5. Upload to database specific directory in Vercel Blob
    const timestampStr = new Date().toISOString().replace(/:/g, "-");
    const filePath = `db-backups/db-${dbRecord.id}/backup-${timestampStr}.sql.gz`;

    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      throw new Error(
        "BLOB_READ_WRITE_TOKEN environment variable is not defined",
      );
    }

    console.log(`Uploading backup to Vercel Blob: ${filePath}`);
    const blobResult = await put(filePath, gzipBuffer, {
      access: "private",
      contentType: "application/gzip",
      addRandomSuffix: false,
    });

    console.log(`Uploaded successfully. URL: ${blobResult.url}`);

    // 6. Prune old backups (Retention logic per database folder)
    const listPrefix = `db-backups/db-${dbRecord.id}/`;
    const listResult = await list({ prefix: listPrefix });
    const backupFiles = listResult.blobs
      .filter((b) => b.pathname.startsWith(listPrefix))
      .sort(
        (a, b) =>
          new Date(a.uploadedAt).getTime() - new Date(b.uploadedAt).getTime(),
      );

    if (backupFiles.length > dbRecord.maxFiles) {
      const filesToDeleteCount = backupFiles.length - dbRecord.maxFiles;
      console.log(
        `Retention check for "${dbRecord.name}": found ${backupFiles.length} files, max is ${dbRecord.maxFiles}. Pruning ${filesToDeleteCount} oldest...`,
      );

      for (let i = 0; i < filesToDeleteCount; i++) {
        const fileToDelete = backupFiles[i];
        console.log(`Pruning file: ${fileToDelete.pathname}`);
        await del(fileToDelete.url);
      }
    }

    // 7. Update status logs in config database
    await db
      .update(schema.databases)
      .set({
        lastSuccessAt: new Date(),
        lastStatus: "SUCCESS",
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.databases.id, dbRecord.id));

    return {
      success: true,
      skipped: false,
      url: blobResult.url,
      path: blobResult.pathname,
      sizeBytes: gzipBuffer.length,
    };
  } catch (error: any) {
    console.error(
      `Backup process for database "${dbRecord.name}" (ID: ${dbRecord.id}) failed:`,
      error,
    );

    // Update status to FAILED in config database
    await db
      .update(schema.databases)
      .set({
        lastStatus: "FAILED",
        lastError: error.message || String(error),
        updatedAt: new Date(),
      })
      .where(eq(schema.databases.id, dbRecord.id));

    throw error;
  } finally {
    await client.end();
  }
}
