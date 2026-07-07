import * as schema from '../db/schema';
import { is } from 'drizzle-orm';
import { PgTable, getTableConfig } from 'drizzle-orm/pg-core';

function getTopologicalSortedTables(tables: PgTable[]): string[] {
  const tableMap = new Map<string, PgTable>();
  const adj = new Map<string, string[]>();
  
  for (const table of tables) {
    const config = getTableConfig(table);
    const tableName = config.name;
    tableMap.set(tableName, table);
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
    if (temp.has(node)) return; // Cycle detection
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

async function main() {
  const allTables = Object.values(schema).filter((val): val is PgTable => is(val, PgTable));
  const sortedNames = getTopologicalSortedTables(allTables);
  
  console.log("Topological Order:", sortedNames);
  console.log("\n--- Generated SQL schema ---\n");
  
  // Create table map for easy lookup
  const tableMap = new Map<string, PgTable>();
  for (const t of allTables) {
    tableMap.set(getTableConfig(t).name, t);
  }
  
  // Drop statements in reverse topological order (to avoid constraint conflicts)
  for (let i = sortedNames.length - 1; i >= 0; i--) {
    const name = sortedNames[i];
    if (name === 'backup_settings') continue; // Exclude backup settings from backup
    console.log(`DROP TABLE IF EXISTS ${name} CASCADE;`);
  }
  console.log("");

  // Create statements in topological order
  for (const name of sortedNames) {
    if (name === 'backup_settings') continue; // Exclude backup settings
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
    console.log(`CREATE TABLE ${name} (\n  ${allDefs.join(',\n  ')}\n);\n`);
  }
}

main().catch(console.error);
