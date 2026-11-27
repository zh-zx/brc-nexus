import { getDb, tx } from '../db/connection.js';
import { v4 as uuidv4 } from 'uuid';
import * as XLSX from 'xlsx';

/**
 * Auto-detect column purposes from Excel headers
 */
export function detectColumns(headers) {
  const map = { id: null, name: null, species: null, origin: null };
  for (const h of headers) {
    const hl = h.toLowerCase().trim();
    // ID column detection
    if (!map.id && (
      hl.includes('cccap') || hl.includes('编号') || hl === 'id' ||
      hl.includes('accession') || hl === 'accno' || hl === 'acc_no'
    )) map.id = h;
    // Name column detection
    if (!map.name && (
      hl.includes('name') || hl.includes('名称') || hl.includes('品种') || hl.includes('variety')
    )) map.name = h;
    // Species column detection
    if (!map.species && (
      hl.includes('species') || hl.includes('学名') || hl.includes('物种') || hl.includes('taxa')
    )) map.species = h;
    // Origin column detection
    if (!map.origin && (
      hl.includes('origin') || hl.includes('原产') || hl.includes('采集') || hl.includes('来源') || hl.includes('country')
    )) map.origin = h;
  }
  // Fallback: first column as ID if nothing matched
  if (!map.id && headers.length > 0) map.id = headers[0];
  if (!map.name && headers.length > 1) map.name = headers[1];
  return map;
}

/**
 * Parse Excel buffer into rows
 */
export function parseExcel(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  return rows;
}

/**
 * Import Excel data into database
 * Returns { inserted, updated, skipped, errors }
 */
export function importExcel(rows, mapping, mode, userId) {
  const db = getDb();
  const uploadId = uuidv4();
  const results = { inserted: 0, updated: 0, skipped: 0, errors: [] };

  // Save raw upload record
  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
  db.prepare(`INSERT INTO excel_upload (id, filename, row_count, import_mode, raw_columns_json, raw_rows_json, mapping_json, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(uploadId, 'excel_import', rows.length, mode, JSON.stringify(headers), JSON.stringify(rows), JSON.stringify(mapping), userId || 'unknown');

  const idField = mapping.id || headers[0];
  const nameField = mapping.name || headers[1] || idField;

  // Prepare statements
  const upsert = db.prepare(`
    INSERT INTO accession (id, data_json, primary_id, display_name, species, origin, source_upload_id, last_modified_by, last_modified_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      data_json = excluded.data_json,
      display_name = excluded.display_name,
      species = excluded.species,
      origin = excluded.origin,
      source_upload_id = excluded.source_upload_id,
      last_modified_by = excluded.last_modified_by,
      last_modified_at = datetime('now')
  `);

  const insertOnly = db.prepare(`
    INSERT OR IGNORE INTO accession (id, data_json, primary_id, display_name, species, origin, source_upload_id, last_modified_by, last_modified_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `);

  const insertUpdate = db.prepare(`
    INSERT INTO accession (id, data_json, primary_id, display_name, species, origin, source_upload_id, last_modified_by, last_modified_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      data_json = CASE WHEN excluded.data_json IS NOT NULL AND json_type(excluded.data_json) IS NOT NULL THEN excluded.data_json ELSE data_json END,
      display_name = COALESCE(NULLIF(excluded.display_name, ''), display_name),
      species = COALESCE(NULLIF(excluded.species, ''), species),
      origin = COALESCE(NULLIF(excluded.origin, ''), origin)
  `);

  // node:sqlite 的 DatabaseSync 没有 .transaction()（那是 better-sqlite3 的 API）——
  // 必须走 connection.js 封装的 tx()，抛错自动回滚（v2.19 修复：此前 db.transaction is not a function，导入必然 500）
  const transaction = () => {
    for (const row of rows) {
      try {
        const rawId = String(row[idField] || '').trim();
        if (!rawId) {
          results.errors.push({ row: JSON.stringify(row), error: '缺少唯一编号' });
          continue;
        }

        const accId = rawId;
        const dataJson = JSON.stringify(row);
        const displayName = String(row[nameField] || row[idField] || '').trim();
        const species = mapping.species ? String(row[mapping.species] || '').trim() : '';
        const origin = mapping.origin ? String(row[mapping.origin] || '').trim() : '';

        if (mode === 'skip') {
          const existing = db.prepare('SELECT id FROM accession WHERE id = ?').get(accId);
          if (existing) {
            results.skipped++;
            continue;
          }
          insertOnly.run(accId, dataJson, rawId, displayName, species, origin, uploadId, userId || 'unknown');
          results.inserted++;
        } else if (mode === 'merge') {
          const existing = db.prepare('SELECT id FROM accession WHERE id = ?').get(accId);
          insertUpdate.run(accId, dataJson, rawId, displayName, species, origin, uploadId, userId || 'unknown');
          existing ? results.updated++ : results.inserted++;
        } else {
          // replace/overwrite (default)
          upsert.run(accId, dataJson, rawId, displayName, species, origin, uploadId, userId || 'unknown');
          const existing = db.prepare('SELECT id FROM accession WHERE id = ?').get(accId);
          // We can't easily know if it was insert vs update here, approximate
          results.inserted++;
        }
      } catch (err) {
        results.errors.push({ row: JSON.stringify(row), error: err.message });
      }
    }
  };

  tx(transaction);
  return results;
}
