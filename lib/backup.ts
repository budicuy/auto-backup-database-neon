import { getDirectPgClient } from '../db/index';
import * as schema from '../db/schema';
import { is, eq } from 'drizzle-orm';
import { PgTable, getTableConfig } from 'drizzle-orm/pg-core';
import { put, list, del } from '@vercel/blob';
import * as zlib from 'zlib';
import { db } from '../db/index';

// Available intervals converted to milliseconds
const INTERVAL_MS = {
  '3_DAYS': 3 * 24 * 60 * 60 * 1000,
  '1_WEEK': 7 * 24 * 60 * 60 * 1000,
  '1_MONTH': 30 * 24 * 60 * 60 * 1000,
  '1_YEAR': 365 * 24 * 60 * 60 * 1000,
};

/**
 * Gets topological sorted table names based on Drizzle foreign key relationships.
 */
function getTopologicalSortedTables(tables: PgTable[]): string[] {
  const adj = new Map<string, string[]>();
  
  for (const table of tables) {
    const config = getTableConfig(table);
    const tableName = config.name;
    if (!adj.has(tableName)) {
      adj.set(tableName, []);
    }
    
    for (const fk of config.foreignKeys) {
      const ref = fk.reference();
      const foreignTableName = getTableConfig(ref.foreignTable).name;
      adj.get(tableName)!.push(foreignTableName);
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
        if (adj.has(dep)) {
          visit(dep);
        }
      }
      temp.delete(node);
      visited.add(node);
      order.push(node);
    }
  }
  
  for (const tableName of adj.keys()) {
    if (!visited.has(tableName)) {
      visit(tableName);
    }
  }
  
  return order;
}

/**
 * Formats JS values into SQL string literals.
 */
function formatValue(value: any): string {
  if (value === null || value === undefined) {
    return 'NULL';
  }
  if (value instanceof Date) {
    return `'${value.toISOString()}'`;
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (typeof value === 'number') {
    return String(value);
  }
  if (typeof value === 'object') {
    if (Buffer.isBuffer(value)) {
      return `E'\\\\x${value.toString('hex')}'`;
    }
    return `'${JSON.stringify(value).replace(/'/g, "''")}'`;
  }
  return `'${String(value).replace(/'/g, "''")}'`;
}

/**
 * Gets or initializes backup settings.
 */
export async function getOrInitializeSettings() {
  try {
    const settings = await db.select().from(schema.backupSettings).limit(1);
    if (settings.length > 0) {
      return settings[0];
    }
    
    // Insert defaults if table is empty
    const newSettings = await db.insert(schema.backupSettings).values({
      interval: '1_WEEK',
      maxFiles: 10,
    }).returning();
    
    return newSettings[0];
  } catch (error: any) {
    console.error("Error reading backup settings from DB:", error);
    throw new Error(`Failed to read/initialize backup settings. Make sure Drizzle migrations are pushed. Error: ${error.message}`);
  }
}

/**
 * Main function to run the backup job.
 */
export async function runBackupJob(isManualOverride: boolean) {
  console.log(`Starting backup job. Manual Override: ${isManualOverride}`);
  
  // 1. Fetch settings
  const settings = await getOrInitializeSettings();
  
  // 2. Check if backup is due
  if (!isManualOverride && settings.lastSuccessAt) {
    const lastRun = new Date(settings.lastSuccessAt).getTime();
    let intervalMs = 0;
    
    if (settings.interval === 'CUSTOM') {
      const days = settings.customDays || 1;
      intervalMs = days * 24 * 60 * 60 * 1000;
    } else {
      intervalMs = INTERVAL_MS[settings.interval] || INTERVAL_MS['1_WEEK'];
    }
    
    const timeElapsed = Date.now() - lastRun;
    if (timeElapsed < intervalMs) {
      const nextRunTime = new Date(lastRun + intervalMs);
      console.log(`Backup skipped. Next scheduled backup at: ${nextRunTime.toISOString()}`);
      return {
        success: true,
        skipped: true,
        message: `Interval not reached. Next backup due at: ${nextRunTime.toLocaleDateString()}`,
        settings
      };
    }
  }

  // 3. Connect via TCP direct pg client for dumping
  const client = getDirectPgClient();
  await client.connect();
  
  try {
    // Collect tables defined in Drizzle schema
    const allTables = Object.values(schema).filter((val): val is PgTable => is(val, PgTable));
    const sortedTableNames = getTopologicalSortedTables(allTables);
    
    const tableMap = new Map<string, PgTable>();
    for (const table of allTables) {
      tableMap.set(getTableConfig(table).name, table);
    }
    
    let sqlDump = `-- Neon Backup SQL Dump\n`;
    sqlDump += `-- Generated: ${new Date().toISOString()}\n\n`;
    
    // Disable triggers and foreign keys during restore to prevent constraint errors
    sqlDump += `SET session_replication_role = 'replica';\n\n`;
    
    // Generate DROPs in reverse topological order (excluding backup_settings)
    sqlDump += `-- 1. Drop existing tables\n`;
    for (let i = sortedTableNames.length - 1; i >= 0; i--) {
      const name = sortedTableNames[i];
      if (name === 'backup_settings') continue; // Do not drop backup settings table
      sqlDump += `DROP TABLE IF EXISTS ${name} CASCADE;\n`;
    }
    sqlDump += `\n`;
    
    // Generate CREATEs in topological order (excluding backup_settings)
    sqlDump += `-- 2. Create tables structure\n`;
    for (const name of sortedTableNames) {
      if (name === 'backup_settings') continue;
      const table = tableMap.get(name)!;
      const config = getTableConfig(table);
      
      const colDefinitions = config.columns.map(col => {
        let def = `${col.name} ${col.getSQLType()}`;
        if (col.primary) def += ' PRIMARY KEY';
        else if (col.notNull) def += ' NOT NULL';
        
        if (col.hasDefault && col.default !== undefined) {
          if (typeof col.default === 'object' && 'queryChunks' in col.default) {
            const sqlObj = col.default as any;
            const value = sqlObj.queryChunks?.[0]?.value?.[0];
            if (value) {
              def += ` DEFAULT ${value}`;
            }
          } else {
            const val = col.default;
            if (typeof val === 'string') {
              def += ` DEFAULT '${val.replace(/'/g, "''")}'`;
            } else {
              def += ` DEFAULT ${val}`;
            }
          }
        }
        return def;
      });

      const fkDefinitions = config.foreignKeys.map(fk => {
        const ref = fk.reference();
        const foreignTableName = getTableConfig(ref.foreignTable).name;
        const localColName = ref.columns[0].name;
        const foreignColName = ref.foreignColumns[0].name;
        const onDelete = fk.onDelete ? ` ON DELETE ${fk.onDelete.toUpperCase()}` : '';
        return `FOREIGN KEY (${localColName}) REFERENCES ${foreignTableName}(${foreignColName})${onDelete}`;
      });

      const allDefs = [...colDefinitions, ...fkDefinitions];
      sqlDump += `CREATE TABLE ${name} (\n  ${allDefs.join(',\n  ')}\n);\n\n`;
    }
    
    // Generate INSERTs in topological order (excluding backup_settings)
    sqlDump += `-- 3. Insert table data\n`;
    for (const name of sortedTableNames) {
      if (name === 'backup_settings') continue;
      const table = tableMap.get(name)!;
      const config = getTableConfig(table);
      
      // Select all records from the table
      const res = await client.query(`SELECT * FROM ${name};`);
      
      if (res.rows.length > 0) {
        sqlDump += `-- Data for table: ${name}\n`;
        const columns = config.columns.map(c => c.name);
        
        for (const row of res.rows) {
          const values = config.columns.map(c => formatValue(row[c.name]));
          sqlDump += `INSERT INTO ${name} (${columns.join(', ')}) VALUES (${values.join(', ')});\n`;
        }
        
        // Reset sequence if table has serial column
        const serialCol = config.columns.find(c => c.getSQLType().includes('serial'));
        if (serialCol) {
          sqlDump += `SELECT setval(pg_get_serial_sequence('${name}', '${serialCol.name}'), coalesce(max(${serialCol.name}), 1), max(${serialCol.name}) IS NOT NULL) FROM ${name};\n`;
        }
        sqlDump += `\n`;
      }
    }
    
    // Restore replication role configuration
    sqlDump += `SET session_replication_role = 'origin';\n`;
    
    // 4. Compress to Gzip
    const sqlBuffer = Buffer.from(sqlDump, 'utf8');
    const gzipBuffer = zlib.gzipSync(sqlBuffer);
    
    // 5. Upload to Vercel Blob
    const timestampStr = new Date().toISOString().replace(/:/g, '-');
    const filePath = `db-backups/backup-${timestampStr}.sql.gz`;
    
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      throw new Error("BLOB_READ_WRITE_TOKEN environment variable is not defined");
    }
    
    console.log(`Uploading backup to Vercel Blob: ${filePath}`);
    const blobResult = await put(filePath, gzipBuffer, {
      access: 'public',
      contentType: 'application/gzip',
      addRandomSuffix: false // keeps names readable
    });
    
    console.log(`Uploaded successfully. URL: ${blobResult.url}`);
    
    // 6. Prune old backups (Retention logic)
    const listResult = await list({ prefix: 'db-backups/' });
    // Filter and sort by uploadedAt ascending (oldest first)
    const backupFiles = listResult.blobs
      .filter(b => b.pathname.startsWith('db-backups/'))
      .sort((a, b) => new Date(a.uploadedAt).getTime() - new Date(b.uploadedAt).getTime());
      
    if (backupFiles.length > settings.maxFiles) {
      const filesToDeleteCount = backupFiles.length - settings.maxFiles;
      console.log(`Retention rule check: ${backupFiles.length} files found, max permitted is ${settings.maxFiles}. Pruning ${filesToDeleteCount} oldest backup(s)...`);
      
      for (let i = 0; i < filesToDeleteCount; i++) {
        const fileToDelete = backupFiles[i];
        console.log(`Pruning old backup: ${fileToDelete.pathname}`);
        await del(fileToDelete.url);
      }
    }
    
    // 7. Update status in database
    await db.update(schema.backupSettings)
      .set({
        lastSuccessAt: new Date(),
        lastStatus: 'SUCCESS',
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.backupSettings.id, settings.id));
      
    return {
      success: true,
      skipped: false,
      url: blobResult.url,
      path: blobResult.pathname,
      sizeBytes: gzipBuffer.length
    };
    
  } catch (error: any) {
    console.error("Backup process encountered an error:", error);
    
    // Update fail status in database
    await db.update(schema.backupSettings)
      .set({
        lastStatus: 'FAILED',
        lastError: error.message || String(error),
        updatedAt: new Date(),
      })
      .where(eq(schema.backupSettings.id, settings.id));
      
    throw error;
  } finally {
    await client.end();
  }
}
