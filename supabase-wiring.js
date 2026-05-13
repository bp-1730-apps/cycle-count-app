/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  CYCLEOPS · PLANT 1730  ·  SUPABASE WIRING                              ║
 * ║                                                                          ║
 * ║  Drop-in replacement for every localStorage STUB in the five HTML pages. ║
 * ║                                                                          ║
 * ║  HOW TO USE                                                              ║
 * ║  1. Add to each HTML page, BEFORE the closing </body> tag:               ║
 * ║       <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>
 * ║       <script src="supabase-wiring.js"></script>                         ║
 * ║  2. Fill in SUPABASE_URL and SUPABASE_ANON_KEY below.                   ║
 * ║  3. In each page, replace the // STUB comments with the                  ║
 * ║     corresponding DB.xxx() call shown in each section.                   ║
 * ║                                                                          ║
 * ║  The localStorage layer is kept as a write-through cache so the app      ║
 * ║  still works offline / before the first Supabase response arrives.       ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */

/* ══════════════════════════════════════════════════════
   CLIENT INIT  —  fill in your project values
══════════════════════════════════════════════════════ */
const SUPABASE_URL      = 'https://zdbgynzycjjaawzjyptv.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpkYmd5bnp5Y2pqYWF3emp5cHR2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg2ODI2MDMsImV4cCI6MjA5NDI1ODYwM30.85EvZWcNkZDBYdgpzFZu5z4Lda-twbAfZBw-B0_ep5s';

const _sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* ══════════════════════════════════════════════════════
   STORAGE KEYS (mirrors what the pages use)
══════════════════════════════════════════════════════ */
const LS = {
  INV   : 'cc_inventory_v1',
  SES   : 'cc_session_active_v1',
  HIST  : 'cc_session_history_v1',
  REQ   : 'cc_adhoc_requests_v1',
  FRESH : 'cc_fresh_counts_v1',
  UPLD  : 'cc_last_upload_v1',
};
const writeLS = (k, v) => localStorage.setItem(k, JSON.stringify(v));
const readLS  = (k)    => { try { return JSON.parse(localStorage.getItem(k)) || []; } catch { return []; } };


/* ══════════════════════════════════════════════════════════════════════════
   ░░░  SECTION 1 — INVENTORY ITEMS  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
   Used by: scanner.html, monitor.html
══════════════════════════════════════════════════════════════════════════ */

/**
 * Load the full inventory array from Supabase and sync to localStorage.
 * Replace:  const inv = readLS(LS.INV);
 * With:     const inv = await DB.getInventory();
 */
async function getInventory() {
  const { data, error } = await _sb
    .from('inventory_items')
    .select('*')
    .order('expected_bin')
    .order('material_id');

  if (error) { console.error('[DB] getInventory:', error); return readLS(LS.INV); }
  writeLS(LS.INV, data);
  return data;
}

/**
 * Get all items for a specific bin (called when auditor loads a bin).
 * Replace:  const items = readInv().filter(i => i.expected_bin === bin);
 * With:     const items = await DB.getItemsByBin(bin);
 */
async function getItemsByBin(binKey) {
  const { data, error } = await _sb
    .from('inventory_items')
    .select('*')
    .eq('expected_bin', binKey)
    .order('material_id');

  if (error) {
    console.error('[DB] getItemsByBin:', error);
    return readLS(LS.INV).filter(i => i.expected_bin === binKey);
  }
  return data;
}

/**
 * Save (upsert) one audited inventory item back to Supabase.
 * Replace the // STUB: await supabase.from('inventory_items').upsert({...}) comment.
 * Call:  await DB.upsertItem(updatedItemObject);
 */
async function upsertItem(item) {
  // Write-through: update localStorage immediately for snappy UI
  const inv = readLS(LS.INV);
  const idx = inv.findIndex(i => i.hu_number === item.hu_number);
  if (idx >= 0) inv[idx] = item; else inv.push(item);
  writeLS(LS.INV, inv);

  const { error } = await _sb
    .from('inventory_items')
    .upsert(item, { onConflict: 'hu_number' });

  if (error) console.error('[DB] upsertItem:', error);
}

/**
 * Bulk replace the master inventory array after a SAP import.
 * Replace:  localStorage.setItem(LS.INV, JSON.stringify(items));
 * With:     await DB.replaceInventory(items, uploadBatchId);
 */
async function replaceInventory(items, uploadBatchId) {
  const timestamp    = new Date().toISOString();
  const stamped      = items.map(i => ({
    ...i,
    upload_batch_id : uploadBatchId || `upload-${Date.now()}`,
    uploaded_at     : timestamp,
    status          : i.status || 'pending_count',
  }));

  // Write-through cache
  writeLS(LS.INV, stamped);

  // NOTE: For large imports (3,000+ rows) batch in chunks of 500
  const CHUNK = 500;
  for (let i = 0; i < stamped.length; i += CHUNK) {
    const chunk = stamped.slice(i, i + CHUNK);
    const { error } = await _sb
      .from('inventory_items')
      .upsert(chunk, { onConflict: 'hu_number' });
    if (error) { console.error('[DB] replaceInventory chunk error:', error); break; }
  }

  // Store upload metadata
  const meta = {
    filename       : `SAP Import ${new Date().toLocaleDateString()}`,
    uploaded_at    : timestamp,
    items_loaded   : stamped.length,
    upload_batch_id: uploadBatchId,
  };
  writeLS(LS.UPLD, meta);
  return { loaded: stamped.length };
}


/* ══════════════════════════════════════════════════════════════════════════
   ░░░  SECTION 2 — CYCLE COUNT SESSIONS  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
   Used by: scanner.html, monitor.html
══════════════════════════════════════════════════════════════════════════ */

/**
 * Create or resume a session.
 * Replace:  writeSes(S.session)
 * With:     await DB.upsertSession(S.session);
 */
async function upsertSession(session) {
  writeLS(LS.SES, session);

  const { error } = await _sb
    .from('cycle_count_sessions')
    .upsert(session, { onConflict: 'id' });

  if (error) console.error('[DB] upsertSession:', error);
}

/**
 * Submit a session and compute snapshot tallies.
 * Replace:  localStorage.removeItem(LS.SES);
 * With:     await DB.submitSession(sessionId);
 */
async function submitSession(sessionId) {
  localStorage.removeItem(LS.SES);

  // Call the database function that tallies stats and marks status = 'submitted'
  const { error } = await _sb.rpc('fn_session_snapshot', {
    session_id_in: sessionId,
  });

  if (error) {
    // Fallback: manual update
    await _sb
      .from('cycle_count_sessions')
      .update({ status: 'submitted', submitted_at: new Date().toISOString() })
      .eq('id', sessionId);
    console.error('[DB] fn_session_snapshot fallback used:', error);
  }
}

/**
 * Load session history for the history table on monitor.html.
 * Replace:  readLS(LS.HIST)
 * With:     const sessions = await DB.getSessionHistory(limit);
 */
async function getSessionHistory(limit = 50) {
  const { data, error } = await _sb
    .from('cycle_count_sessions')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(limit);

  if (error) { console.error('[DB] getSessionHistory:', error); return readLS(LS.HIST); }
  writeLS(LS.HIST, data);
  return data;
}

/**
 * Reconcile a session (manager marks it done in the detail drawer).
 * Replace:  r.status = 'Reconciled'; renderTable();
 * With:     await DB.reconcileSession(sessionId, managerName);
 */
async function reconcileSession(sessionId, reconciledBy) {
  const { error } = await _sb
    .from('cycle_count_sessions')
    .update({
      status        : 'reconciled',
      reconciled_at : new Date().toISOString(),
      reconciled_by : reconciledBy || 'Manager',
    })
    .eq('id', sessionId);

  if (error) console.error('[DB] reconcileSession:', error);
}


/* ══════════════════════════════════════════════════════════════════════════
   ░░░  SECTION 3 — AD-HOC REQUESTS  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
   Used by: monitor.html, scanner.html, requests.html
══════════════════════════════════════════════════════════════════════════ */

/**
 * Create a new ad-hoc request.
 * Replace:  all.unshift(task); writeLS(LS.REQ, all);
 * With:     const task = await DB.createRequest({...});
 */
async function createRequest({ material_id, description, notes, requested_by, priority }) {
  const task = {
    id            : `ADHOC-${Date.now()}`,
    material_id   : String(material_id).trim().toUpperCase(),
    description,
    notes,
    requested_by,
    priority      : priority || 'normal',
    status        : 'pending',
    requested_at  : new Date().toISOString(),
    is_adhoc_request: true,
  };

  // Write-through
  const all = readLS(LS.REQ); all.unshift(task); writeLS(LS.REQ, all);

  const { error } = await _sb.from('adhoc_requests').insert(task);
  if (error) console.error('[DB] createRequest:', error);
  return task;
}

/**
 * Mark a request in_progress (auditor taps "Start Count").
 * Replace:  reqs[ri].status = 'in_progress'; writeLS(LS.REQ, reqs);
 * With:     await DB.startRequest(reqId, auditorName);
 */
async function startRequest(reqId, auditorName) {
  const all = readLS(LS.REQ);
  const idx = all.findIndex(r => r.id === reqId);
  if (idx >= 0) { all[idx].status = 'in_progress'; all[idx].in_progress_by = auditorName; writeLS(LS.REQ, all); }

  const { error } = await _sb
    .from('adhoc_requests')
    .update({ status: 'in_progress', in_progress_by: auditorName, in_progress_at: new Date().toISOString() })
    .eq('id', reqId);

  if (error) console.error('[DB] startRequest:', error);
}

/**
 * Complete a request after the auditor saves the HU count.
 * Replace the Object.assign(reqs[ri], {...}) block in scanner.html.
 * With:     await DB.completeRequest(reqId, completionData);
 */
async function completeRequest(reqId, completionData) {
  const all = readLS(LS.REQ);
  const idx = all.findIndex(r => r.id === reqId);
  if (idx >= 0) { Object.assign(all[idx], completionData, { status: 'completed', completed_at: new Date().toISOString() }); writeLS(LS.REQ, all); }

  const { error } = await _sb
    .from('adhoc_requests')
    .update({ ...completionData, status: 'completed', completed_at: new Date().toISOString() })
    .eq('id', reqId);

  if (error) console.error('[DB] completeRequest:', error);
}

/**
 * Cancel a request.
 * Replace:  reqs[ri].status = 'cancelled'; writeLS(LS.REQ, reqs);
 * With:     await DB.cancelRequest(reqId);
 */
async function cancelRequest(reqId) {
  const all = readLS(LS.REQ);
  const idx = all.findIndex(r => r.id === reqId);
  if (idx >= 0) { all[idx].status = 'cancelled'; writeLS(LS.REQ, all); }

  const { error } = await _sb
    .from('adhoc_requests')
    .update({ status: 'cancelled' })
    .eq('id', reqId);

  if (error) console.error('[DB] cancelRequest:', error);
}

/**
 * Load all ad-hoc requests.
 * Replace:  readLS(LS.REQ)
 * With:     const reqs = await DB.getRequests();
 */
async function getRequests(statusFilter) {
  let query = _sb.from('adhoc_requests').select('*').order('requested_at', { ascending: false });
  if (statusFilter) query = query.eq('status', statusFilter);
  const { data, error } = await query;
  if (error) { console.error('[DB] getRequests:', error); return readLS(LS.REQ); }
  writeLS(LS.REQ, data);
  return data;
}


/* ══════════════════════════════════════════════════════════════════════════
   ░░░  SECTION 4 — FRESH COUNT SESSIONS  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
   Used by: fresh-count.html
══════════════════════════════════════════════════════════════════════════ */

/**
 * Save (upsert) the current fresh count session AND its items/finds.
 * Replace:  writeFresh(all)
 * With:     await DB.saveFreshSession(session);
 */
async function saveFreshSession(session) {
  // Write-through
  const all = readLS('cc_fresh_counts_v1');
  const idx = all.findIndex(s => s.id === session.id);
  if (idx >= 0) all[idx] = session; else all.unshift(session);
  writeLS('cc_fresh_counts_v1', all);

  // 1. Upsert the session header
  const { error: sesErr } = await _sb
    .from('fresh_count_sessions')
    .upsert({
      id           : session.id,
      count_date   : session.date,
      auditor      : session.auditor,
      plant        : '1730',
      status       : session.status,
      submitted_at : session.submitted_at || null,
    }, { onConflict: 'id' });

  if (sesErr) { console.error('[DB] saveFreshSession header:', sesErr); return; }

  // 2. Upsert items
  for (const item of session.items) {
    const { data: itemRow, error: itemErr } = await _sb
      .from('fresh_count_items')
      .upsert({
        session_id  : session.id,
        material_id : item.material_id,
        description : item.description,
        total_lbs   : item.total_lbs,
        notes       : item.notes || '',
        counted     : item.counted,
      }, { onConflict: 'session_id,material_id' })
      .select('id')
      .single();

    if (itemErr) { console.error('[DB] saveFreshSession item:', itemErr); continue; }
    if (!itemRow) continue;

    // 3. Delete old finds for this item and re-insert
    await _sb.from('fresh_count_finds').delete().eq('item_id', itemRow.id);

    const validFinds = (item.finds || []).filter(f => f.lbs > 0);
    if (validFinds.length) {
      await _sb.from('fresh_count_finds').insert(
        validFinds.map(f => ({
          id            : f.id,
          item_id       : itemRow.id,
          session_id    : session.id,
          material_id   : item.material_id,
          location      : f.location || null,
          batch_number  : f.batch_number || null,
          hu_number     : f.hu_number || null,
          pallet_count  : parseInt(f.pallet_count) || null,
          lbs_per_pallet: parseFloat(f.lbs_per_pallet) || null,
          lbs           : parseFloat(f.lbs),
          notes         : f.notes || null,
        }))
      );
    }
  }
}

/**
 * Load all fresh count sessions (for history panel).
 * Replace:  readLS('cc_fresh_counts_v1')
 * With:     const sessions = await DB.getFreshSessions();
 */
async function getFreshSessions() {
  // Load headers
  const { data: sessions, error } = await _sb
    .from('fresh_count_sessions')
    .select(`
      *,
      fresh_count_items (
        id, material_id, description, total_lbs, notes, counted,
        fresh_count_finds ( id, location, batch_number, hu_number, pallet_count, lbs_per_pallet, lbs, notes )
      )
    `)
    .order('count_date', { ascending: false })
    .limit(20);

  if (error) { console.error('[DB] getFreshSessions:', error); return readLS('cc_fresh_counts_v1'); }

  // Reshape to match the app's localStorage structure
  const shaped = sessions.map(s => ({
    id           : s.id,
    date         : s.count_date,
    auditor      : s.auditor,
    status       : s.status,
    created_at   : s.created_at,
    submitted_at : s.submitted_at,
    items        : (s.fresh_count_items || []).map(i => ({
      material_id : i.material_id,
      description : i.description,
      total_lbs   : i.total_lbs,
      notes       : i.notes,
      counted     : i.counted,
      finds       : (i.fresh_count_finds || []).map(f => ({
        id             : f.id,
        location       : f.location || '',
        batch_number   : f.batch_number || '',
        hu_number      : f.hu_number || '',
        pallet_count   : f.pallet_count || '',
        lbs_per_pallet : f.lbs_per_pallet || '',
        lbs            : f.lbs,
        notes          : f.notes || '',
      })),
    })),
  }));

  writeLS('cc_fresh_counts_v1', shaped);
  return shaped;
}


/* ══════════════════════════════════════════════════════════════════════════
   ░░░  SECTION 5 — PHOTO UPLOAD TO SUPABASE STORAGE  ░░░░░░░░░░░░░░░░░░
   Used by: scanner.html  (replaces base64 in localStorage)
══════════════════════════════════════════════════════════════════════════ */

/**
 * Upload a compressed photo blob to Supabase Storage and return the public URL.
 * Replace the canvas base64 URI with this.
 *
 * In scanner.html, replace compressPhoto() usage:
 *
 *   // OLD (localStorage):
 *   const uri = await compressPhoto(file);
 *   S.photoURI = uri;
 *
 *   // NEW (Supabase Storage):
 *   const url = await DB.uploadPhoto(file, S.session.id, S.selectedHU.hu_number);
 *   S.photoURI = url;
 */
async function uploadPhoto(file, sessionId, huNumber) {
  // Still compress first to keep file sizes manageable
  const compressed = await compressPhotoToBlob(file, 900, 0.70);

  const filename  = `${sessionId}/${huNumber}_${Date.now()}.jpg`;
  const { data, error } = await _sb.storage
    .from('count-photos')
    .upload(filename, compressed, {
      contentType : 'image/jpeg',
      upsert      : true,
    });

  if (error) {
    console.error('[DB] uploadPhoto:', error);
    // Fallback to base64 data URI so the app doesn't break
    return await compressPhotoToDataUri(file, 900, 0.65);
  }

  const { data: pub } = _sb.storage.from('count-photos').getPublicUrl(data.path);
  return pub.publicUrl;
}

/**
 * Helper: compress a File to a Blob (for Storage upload).
 */
function compressPhotoToBlob(file, maxWidth, quality) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error('FileReader failed'));
    r.onload  = e => {
      const img = new Image();
      img.onerror = () => reject(new Error('Image load failed'));
      img.onload  = () => {
        const scale  = Math.min(1, maxWidth / img.width);
        const canvas = document.createElement('canvas');
        canvas.width  = Math.round(img.width  * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(blob => resolve(blob), 'image/jpeg', quality);
      };
      img.src = e.target.result;
    };
    r.readAsDataURL(file);
  });
}

/**
 * Helper: compress to data URI (offline fallback — same as the current inline compressPhoto).
 */
function compressPhotoToDataUri(file, maxWidth, quality) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject();
    r.onload  = e => {
      const img = new Image();
      img.onerror = () => reject();
      img.onload  = () => {
        const scale  = Math.min(1, maxWidth / img.width);
        const canvas = document.createElement('canvas');
        canvas.width  = Math.round(img.width  * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = e.target.result;
    };
    r.readAsDataURL(file);
  });
}


/* ══════════════════════════════════════════════════════════════════════════
   ░░░  SECTION 6 — REALTIME SUBSCRIPTIONS  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░
   Replace window.addEventListener('storage', ...) cross-tab events.
══════════════════════════════════════════════════════════════════════════ */

/**
 * Subscribe to live inventory changes (for monitor.html dashboard refresh).
 * Call once on page load:  DB.subscribeInventory(callback);
 *
 * Replace:
 *   window.addEventListener('storage', e => { if (e.key === LS.INV) refresh(); });
 * With:
 *   DB.subscribeInventory(() => { refreshKPIs(); renderUploadPanel(); });
 */
function subscribeInventory(callback) {
  return _sb
    .channel('inventory_changes')
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'inventory_items' },
      payload => { console.log('[RT] inventory_items change:', payload.eventType); callback(payload); }
    )
    .subscribe();
}

/**
 * Subscribe to ad-hoc request changes (monitor ↔ scanner ↔ requests live updates).
 * Replace:
 *   window.addEventListener('storage', e => { if (e.key === LS.REQ) updateReqBadge(); });
 * With:
 *   DB.subscribeRequests(() => { updateReqBadge(); renderActiveRequests(); });
 */
function subscribeRequests(callback) {
  return _sb
    .channel('request_changes')
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'adhoc_requests' },
      payload => { console.log('[RT] adhoc_requests change:', payload.eventType); callback(payload); }
    )
    .subscribe();
}

/**
 * Subscribe to fresh count changes.
 */
function subscribeFreshCounts(callback) {
  return _sb
    .channel('fresh_count_changes')
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'fresh_count_sessions' },
      payload => callback(payload)
    )
    .subscribe();
}

/**
 * Unsubscribe from all realtime channels (call on page unload).
 */
function unsubscribeAll() {
  _sb.removeAllChannels();
}
window.addEventListener('beforeunload', unsubscribeAll);


/* ══════════════════════════════════════════════════════════════════════════
   ░░░  SECTION 7 — KPI QUERIES  (replaces JS aggregations)  ░░░░░░░░░░░░
   Used by: monitor.html
══════════════════════════════════════════════════════════════════════════ */

/**
 * Fetch inventory accuracy KPI data from the database view.
 * Replace the manual inv.filter() aggregations in refreshKPIs().
 */
async function getInventoryKPIs() {
  const { data, error } = await _sb.from('v_inventory_accuracy').select('*').single();
  if (error) { console.error('[DB] getInventoryKPIs:', error); return null; }
  return data;
}

/**
 * Fetch daily count data for sparkline charts.
 */
async function getDailyCounts(days = 9) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const { data, error } = await _sb
    .from('v_daily_counts')
    .select('*')
    .gte('count_date', since)
    .order('count_date');
  if (error) { console.error('[DB] getDailyCounts:', error); return []; }
  return data;
}

/**
 * Fetch the reconciliation report from the database view.
 */
async function getReconciliationReport() {
  const { data, error } = await _sb
    .from('v_reconciliation_report')
    .select('*');
  if (error) { console.error('[DB] getReconciliationReport:', error); return []; }
  return data;
}

/**
 * Fetch the fresh count vs SAP comparison.
 */
async function getFreshVsSAP() {
  const { data, error } = await _sb
    .rpc('fn_fresh_count_total', {})   // or use the view
    .from('v_fresh_count_latest')
    .select('*');
  if (error) { console.error('[DB] getFreshVsSAP:', error); return []; }
  return data;
}


/* ══════════════════════════════════════════════════════════════════════════
   ░░░  EXPORT (consumed by the HTML pages)  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░
══════════════════════════════════════════════════════════════════════════ */
window.DB = {
  // Client (for direct usage if needed)
  client              : _sb,

  // Inventory
  getInventory,
  getItemsByBin,
  upsertItem,
  replaceInventory,

  // Sessions
  upsertSession,
  submitSession,
  getSessionHistory,
  reconcileSession,

  // Requests
  createRequest,
  startRequest,
  completeRequest,
  cancelRequest,
  getRequests,

  // Fresh counts
  saveFreshSession,
  getFreshSessions,

  // Photos
  uploadPhoto,

  // Realtime
  subscribeInventory,
  subscribeRequests,
  subscribeFreshCounts,
  unsubscribeAll,

  // KPIs
  getInventoryKPIs,
  getDailyCounts,
  getReconciliationReport,
  getFreshVsSAP,
};

console.info('[CycleOps] Supabase wiring loaded. Project:', SUPABASE_URL);


/* ══════════════════════════════════════════════════════════════════════════
   ░░░  QUICK-REFERENCE — WHERE EACH STUB LIVES  ░░░░░░░░░░░░░░░░░░░░░░░
   Search each file for "// STUB" to find every replacement point.
══════════════════════════════════════════════════════════════════════════

   scanner.html
   ────────────
   Line ~783  "// STUB: await supabase.from('inventory_items').upsert"
              → Replace: await DB.upsertItem(updated);

   Line ~803  Object.assign(reqs[ri], {...}); writeReq(reqs);
              → Replace: await DB.completeRequest(S.adhocReqId, { result_hu, ... });

   Line ~879  "// STUB: await supabase.from('sessions').update"
              → Replace: await DB.submitSession(S.session.id);

   Line ~921  reqs[ri].status = 'in_progress'; writeReq(reqs);
              → Replace: await DB.startRequest(reqId, S.session.user);

   Photo capture (compressPhoto call):
              → Replace: const url = await DB.uploadPhoto(file, S.session.id, S.selectedHU.hu_number);
                         S.photoURI = url;

   Cross-tab storage event:
              → Replace: DB.subscribeInventory(updateReqBadge);
                         DB.subscribeRequests(updateReqBadge);


   monitor.html
   ─────────────
   btn-submit-req click handler:
              → Replace: const task = await DB.createRequest({...});

   cancelReq():
              → Replace: await DB.cancelRequest(id);

   btn-gen-recon handler:
              → Replace: const rows = await DB.getReconciliationReport();

   drw-reconcile click:
              → Replace: await DB.reconcileSession(activeRow, 'Manager');

   Cross-tab event:
              → Replace: DB.subscribeInventory(() => { refreshKPIs(); renderUploadPanel(); });
                         DB.subscribeRequests(() => { renderActiveRequests(); });

   finishCSVParse → replaceInventory:
              → Replace: await DB.replaceInventory(items, `upload-${Date.now()}`);


   requests.html
   ─────────────
   loadData():
              → Replace: const stored = await DB.getRequests();

   cancelRequest(id):
              → Replace: await DB.cancelRequest(id);


   fresh-count.html
   ─────────────────
   saveCurrentSession():
              → Replace: await DB.saveFreshSession(S.currentSession);

   renderHistory() / loadSession():
              → Replace: const all = await DB.getFreshSessions();

══════════════════════════════════════════════════════════════════════════ */